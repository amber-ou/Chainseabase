import type { Db } from '@/server/db';
import { AppError, assertRevision, invalid } from '@/server/errors';
import { loadFeedbackDtos } from '@/modules/feedback/repo';
import { rankBetween, resolveInsertIndex, sequentialRanks } from '@/modules/roadmap/rank';
import { iso } from '@/modules/shared/text';
import { userRef } from '@/modules/shared/users';

export const DEFAULT_PERSONAL_COLUMN = '負責的 Feedback';

interface ViewRow { id: string; ownerId: string; productId: string; subjectUserId: string; sortMode: 'create_time' | 'freedom'; ranksInitialized: boolean; revision: number }

async function assertSubject(db: Db, subjectUserId: string) {
  const [u] = await db<{ role: string; membershipState: string }[]>`select role, membership_state from users where id = ${subjectUserId}`;
  if (!u || u.role !== 'team' || u.membershipState !== 'active') throw new AppError('NOT_FOUND');
}

/** Responsibility list: live feedback sharing at least one person tag with the subject (deduplicated). */
export async function responsibleFeedback(db: Db, productId: string, subjectUserId: string) {
  return db<{ id: string; createdAt: Date }[]>`
    select f.id, f.created_at from feedback f
    where f.product_id = ${productId} and f.deleted_at is null
      and exists (
        select 1 from feedback_person_tags fpt
        join user_person_tags upt on upt.person_tag_id = fpt.person_tag_id
        join users u on u.id = upt.user_id
        where fpt.feedback_id = f.id and upt.user_id = ${subjectUserId} and u.role = 'team' and u.membership_state = 'active'
      )
  `;
}

/** Owner always comes from the session; a view of someone else answers 404. */
async function loadOwnView(db: Db, ownerId: string, productId: string, viewId: string, lock = false): Promise<ViewRow> {
  const rows = lock
    ? await db<ViewRow[]>`select * from personal_views where id = ${viewId} and owner_id = ${ownerId} and product_id = ${productId} for update`
    : await db<ViewRow[]>`select * from personal_views where id = ${viewId} and owner_id = ${ownerId} and product_id = ${productId}`;
  if (!rows[0]) throw new AppError('NOT_FOUND');
  return rows[0];
}

export async function ensureView(tx: Db, ownerId: string, productId: string, subjectUserId: string): Promise<ViewRow> {
  await assertSubject(tx, subjectUserId);
  const inserted = await tx<ViewRow[]>`
    insert into personal_views (owner_id, product_id, subject_user_id) values (${ownerId}, ${productId}, ${subjectUserId})
    on conflict (owner_id, product_id, subject_user_id) do nothing returning *
  `;
  if (inserted[0]) {
    await tx`insert into personal_columns (view_id, name, position, is_default) values (${inserted[0].id}, ${DEFAULT_PERSONAL_COLUMN}, 0, true)`;
    return inserted[0];
  }
  const [v] = await tx<ViewRow[]>`select * from personal_views where owner_id = ${ownerId} and product_id = ${productId} and subject_user_id = ${subjectUserId}`;
  return v;
}

function byCreatedDesc(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) {
  const d = b.createdAt.getTime() - a.createdAt.getTime();
  return d !== 0 ? d : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

async function computeView(db: Db, view: ViewRow) {
  const columns = await db<{ id: string; name: string; position: number; isDefault: boolean }[]>`
    select id, name, position, is_default from personal_columns where view_id = ${view.id} order by position, created_at, id
  `;
  const cards = await responsibleFeedback(db, view.productId, view.subjectUserId);
  const placements = new Map(
    (await db<{ feedbackId: string; columnId: string; rank: number | null }[]>`select feedback_id, column_id, rank from personal_placements where view_id = ${view.id}`)
      .map((p) => [p.feedbackId, p]),
  );
  const defaultColumn = columns.find((c) => c.isDefault)!;
  const byColumn = new Map(columns.map((c) => [c.id, [] as { id: string; createdAt: Date }[]]));
  for (const card of cards) {
    // first appearance (or a stale placement) goes to the default column
    const p = placements.get(card.id);
    const col = p && byColumn.has(p.columnId) ? p.columnId : defaultColumn.id;
    byColumn.get(col)!.push(card);
  }
  const ordered = new Map<string, string[]>();
  for (const [colId, list] of byColumn) {
    if (view.sortMode === 'create_time') ordered.set(colId, [...list].sort(byCreatedDesc).map((c) => c.id));
    else {
      const rankOf = (id: string) => {
        const p = placements.get(id);
        return p && p.columnId === colId && p.rank !== null ? p.rank : null;
      };
      const unranked = list.filter((c) => rankOf(c.id) === null).sort(byCreatedDesc);
      const ranked = list.filter((c) => rankOf(c.id) !== null).sort((a, b) => rankOf(a.id)! - rankOf(b.id)! || byCreatedDesc(a, b));
      ordered.set(colId, [...unranked, ...ranked].map((c) => c.id));
    }
  }
  return { columns, ordered, placements, defaultColumn, cards };
}

export async function getPersonalView(db: Db, ownerId: string, productId: string, subjectUserId: string) {
  await assertSubject(db, subjectUserId);
  const [view] = await db<ViewRow[]>`select * from personal_views where owner_id = ${ownerId} and product_id = ${productId} and subject_user_id = ${subjectUserId}`;
  const [subject] = await db<{ id: string; displayName: string; avatarPath: string | null; googlePictureUrl: string | null; revision: number }[]>`
    select id, display_name, avatar_path, google_picture_url, revision from users where id = ${subjectUserId}
  `;
  const subjectTags = await db<{ id: string; name: string }[]>`
    select p.id, p.name from user_person_tags upt join person_tags p on p.id = upt.person_tag_id
    where upt.user_id = ${subjectUserId} and upt.product_id = ${productId} order by p.position, p.name
  `;
  const subjectDto = { ...userRef(subject), personTags: [...subjectTags] };
  if (!view) {
    // initial representation; persisted on the first POST /views
    const cards = (await responsibleFeedback(db, productId, subjectUserId)).sort(byCreatedDesc);
    const items = await loadFeedbackDtos(db, productId, cards.map((c) => c.id));
    return {
      view: null, subject: subjectDto,
      columns: [{ id: null, name: DEFAULT_PERSONAL_COLUMN, position: 0, isDefault: true, cards: items }],
    };
  }
  return viewDto(db, view, subjectDto);
}

async function viewDto(db: Db, view: ViewRow, subject: unknown) {
  const { columns, ordered } = await computeView(db, view);
  const allIds = columns.flatMap((c) => ordered.get(c.id)!);
  const items = new Map((await loadFeedbackDtos(db, view.productId, allIds)).map((f) => [f.id, f]));
  return {
    view: { id: view.id, sortMode: view.sortMode, revision: view.revision, subjectUserId: view.subjectUserId },
    subject,
    columns: columns.map((c) => ({ id: c.id, name: c.name, position: c.position, isDefault: c.isDefault, cards: ordered.get(c.id)!.map((id) => items.get(id)).filter(Boolean) })),
  };
}

export async function createOrGetView(tx: Db, ownerId: string, productId: string, subjectUserId: string) {
  await ensureView(tx, ownerId, productId, subjectUserId);
  return getPersonalView(tx, ownerId, productId, subjectUserId);
}

async function bumpView(tx: Db, viewId: string) {
  const [r] = await tx<{ revision: number }[]>`update personal_views set revision = revision + 1 where id = ${viewId} returning revision`;
  return r.revision;
}

/** Freeze the current visible order into explicit placements (first switch to freedom). */
async function initializePlacements(tx: Db, view: ViewRow) {
  const { ordered } = await computeView(tx, { ...view, sortMode: 'create_time' });
  for (const [colId, ids] of ordered) {
    const ranks = sequentialRanks(ids.length);
    for (let i = 0; i < ids.length; i++) {
      await tx`
        insert into personal_placements (view_id, feedback_id, column_id, rank) values (${view.id}, ${ids[i]}, ${colId}, ${ranks[i]})
        on conflict (view_id, feedback_id) do update set column_id = excluded.column_id, rank = excluded.rank
      `;
    }
  }
  await tx`update personal_views set ranks_initialized = true where id = ${view.id}`;
}

export async function setSortMode(tx: Db, ownerId: string, productId: string, viewId: string, sortMode: 'create_time' | 'freedom', expectedRevision: number) {
  const view = await loadOwnView(tx, ownerId, productId, viewId, true);
  assertRevision(view.revision, expectedRevision);
  if (sortMode === 'freedom' && !view.ranksInitialized) await initializePlacements(tx, view);
  await tx`update personal_views set sort_mode = ${sortMode} where id = ${viewId}`;
  return { revision: await bumpView(tx, viewId) };
}

export async function addColumn(tx: Db, ownerId: string, productId: string, viewId: string, name: string, expectedRevision: number) {
  const view = await loadOwnView(tx, ownerId, productId, viewId, true);
  assertRevision(view.revision, expectedRevision);
  const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(position), -1)::int + 1 as next from personal_columns where view_id = ${viewId}`;
  const [c] = await tx<{ id: string; name: string; position: number; isDefault: boolean }[]>`
    insert into personal_columns (view_id, name, position) values (${viewId}, ${name}, ${next}) returning id, name, position, is_default
  `;
  return { column: c, revision: await bumpView(tx, viewId) };
}

export async function renameColumn(tx: Db, ownerId: string, productId: string, viewId: string, columnId: string, name: string, expectedRevision: number) {
  const view = await loadOwnView(tx, ownerId, productId, viewId, true);
  assertRevision(view.revision, expectedRevision);
  const [c] = await tx`update personal_columns set name = ${name} where id = ${columnId} and view_id = ${viewId} returning id`;
  if (!c) throw new AppError('NOT_FOUND');
  return { revision: await bumpView(tx, viewId) };
}

export async function deleteColumn(tx: Db, ownerId: string, productId: string, viewId: string, columnId: string, expectedRevision: number) {
  const view = await loadOwnView(tx, ownerId, productId, viewId, true);
  assertRevision(view.revision, expectedRevision);
  const [c] = await tx<{ isDefault: boolean }[]>`select is_default from personal_columns where id = ${columnId} and view_id = ${viewId}`;
  if (!c) throw new AppError('NOT_FOUND');
  if (c.isDefault) throw new AppError('ACTION_FORBIDDEN', '預設欄不可刪除。');
  const [def] = await tx<{ id: string }[]>`select id from personal_columns where view_id = ${viewId} and is_default`;
  const [{ minRank }] = await tx<{ minRank: number | null }[]>`select min(rank) as min_rank from personal_placements where column_id = ${def.id}`;
  // cards return to the default column (on top, keeping their relative order)
  const moving = await tx<{ feedbackId: string; rank: number | null }[]>`
    select feedback_id, rank from personal_placements where column_id = ${columnId} order by rank nulls first
  `;
  const base = (minRank ?? 0) - 1024 * (moving.length + 1);
  for (let i = 0; i < moving.length; i++) {
    await tx`update personal_placements set column_id = ${def.id}, rank = ${base + i * 1024} where view_id = ${viewId} and feedback_id = ${moving[i].feedbackId}`;
  }
  await tx`delete from personal_columns where id = ${columnId}`;
  return { revision: await bumpView(tx, viewId), movedCount: moving.length };
}

export async function reorderColumns(tx: Db, ownerId: string, productId: string, viewId: string, columnIds: string[], expectedRevision: number) {
  const view = await loadOwnView(tx, ownerId, productId, viewId, true);
  assertRevision(view.revision, expectedRevision);
  const existing = (await tx<{ id: string }[]>`select id from personal_columns where view_id = ${viewId}`).map((r) => r.id);
  if (new Set(columnIds).size !== columnIds.length || columnIds.length !== existing.length || !columnIds.every((id) => existing.includes(id))) {
    throw invalid('必須提供完整且不重複的欄位順序。', { columnIds: '欄位清單不完整' });
  }
  for (let i = 0; i < columnIds.length; i++) await tx`update personal_columns set position = ${i} where id = ${columnIds[i]}`;
  return { revision: await bumpView(tx, viewId) };
}

/** Private move: updates only personal_placements, never Feedback fields. */
export async function moveCard(
  tx: Db, ownerId: string, productId: string, viewId: string,
  input: { feedbackId: string; targetColumnId: string; beforeFeedbackId: string | null; afterFeedbackId: string | null; expectedRevision: number },
) {
  let view = await loadOwnView(tx, ownerId, productId, viewId, true);
  assertRevision(view.revision, input.expectedRevision);
  const [col] = await tx`select id from personal_columns where id = ${input.targetColumnId} and view_id = ${viewId}`;
  if (!col) throw new AppError('NOT_FOUND');
  const responsible = await responsibleFeedback(tx, productId, view.subjectUserId);
  if (!responsible.some((r) => r.id === input.feedbackId)) throw new AppError('NOT_FOUND');
  if (!view.ranksInitialized) {
    await initializePlacements(tx, view);
    view = { ...view, ranksInitialized: true };
  }
  const { ordered, placements } = await computeView(tx, { ...view, sortMode: 'freedom' });
  const order = ordered.get(input.targetColumnId)!.filter((id) => id !== input.feedbackId);
  const index = resolveInsertIndex(order, input, input.feedbackId);
  if (index === 'invalid') throw invalid('落點無效，請重新載入。', { beforeFeedbackId: '必須是目標欄位的相鄰卡片' });
  const rankOf = (id: string | undefined) => {
    if (!id) return null;
    const p = placements.get(id);
    return p && p.columnId === input.targetColumnId ? p.rank : null;
  };
  const aboveId = index > 0 ? order[index - 1] : undefined;
  const belowId = order[index];
  const above = rankOf(aboveId);
  const below = rankOf(belowId);
  const rank = (aboveId && above === null) || (belowId && below === null) ? null : rankBetween(above, below);
  if (rank === null) {
    const full = [...order.slice(0, index), input.feedbackId, ...order.slice(index)];
    const ranks = sequentialRanks(full.length);
    for (let i = 0; i < full.length; i++) {
      await tx`
        insert into personal_placements (view_id, feedback_id, column_id, rank) values (${viewId}, ${full[i]}, ${input.targetColumnId}, ${ranks[i]})
        on conflict (view_id, feedback_id) do update set column_id = excluded.column_id, rank = excluded.rank
      `;
    }
  } else {
    await tx`
      insert into personal_placements (view_id, feedback_id, column_id, rank) values (${viewId}, ${input.feedbackId}, ${input.targetColumnId}, ${rank})
      on conflict (view_id, feedback_id) do update set column_id = excluded.column_id, rank = excluded.rank
    `;
  }
  await tx`update personal_views set sort_mode = 'freedom' where id = ${viewId}`;
  return { revision: await bumpView(tx, viewId) };
}

// ---------------------------------------------------------------------------
// Personal tags (owner + product)
// ---------------------------------------------------------------------------

export async function listPersonalTags(db: Db, ownerId: string, productId: string) {
  const rows = await db<{ id: string; name: string; revision: number; createdAt: Date }[]>`
    select id, name, revision, created_at from personal_tags where owner_id = ${ownerId} and product_id = ${productId} order by created_at, id
  `;
  return rows.map((r) => ({ id: r.id, name: r.name, revision: r.revision, createdAt: iso(r.createdAt) }));
}

export async function createPersonalTag(tx: Db, ownerId: string, productId: string, name: string) {
  const exists = await tx`select 1 from personal_tags where owner_id = ${ownerId} and product_id = ${productId} and name = ${name}`;
  if (exists.length) throw invalid('名稱已存在。', { name: '名稱已存在' });
  const [r] = await tx<{ id: string; name: string; revision: number }[]>`
    insert into personal_tags (owner_id, product_id, name) values (${ownerId}, ${productId}, ${name}) returning id, name, revision
  `;
  return r;
}

export async function renamePersonalTag(tx: Db, ownerId: string, productId: string, tagId: string, name: string, expectedRevision: number) {
  const [t] = await tx<{ revision: number }[]>`select revision from personal_tags where id = ${tagId} and owner_id = ${ownerId} and product_id = ${productId} for update`;
  if (!t) throw new AppError('NOT_FOUND');
  assertRevision(t.revision, expectedRevision);
  const dup = await tx`select 1 from personal_tags where owner_id = ${ownerId} and product_id = ${productId} and name = ${name} and id <> ${tagId}`;
  if (dup.length) throw invalid('名稱已存在。', { name: '名稱已存在' });
  const [r] = await tx<{ id: string; name: string; revision: number }[]>`
    update personal_tags set name = ${name}, revision = revision + 1 where id = ${tagId} returning id, name, revision
  `;
  return r;
}

export async function deletePersonalTag(tx: Db, ownerId: string, productId: string, tagId: string, expectedRevision: number) {
  const [t] = await tx<{ revision: number }[]>`select revision from personal_tags where id = ${tagId} and owner_id = ${ownerId} and product_id = ${productId} for update`;
  if (!t) throw new AppError('NOT_FOUND');
  assertRevision(t.revision, expectedRevision);
  await tx`delete from personal_tags where id = ${tagId}`;
}

export async function getPersonalFeedbackTags(db: Db, ownerId: string, productId: string, feedbackId: string) {
  const [f] = await db`select 1 from feedback where id = ${feedbackId} and product_id = ${productId} and deleted_at is null`;
  if (!f) throw new AppError('NOT_FOUND');
  const [meta] = await db<{ revision: number }[]>`select revision from personal_feedback_metadata where owner_id = ${ownerId} and feedback_id = ${feedbackId}`;
  const tags = await db<{ id: string; name: string }[]>`
    select t.id, t.name from personal_feedback_tags pft join personal_tags t on t.id = pft.personal_tag_id
    where pft.owner_id = ${ownerId} and pft.feedback_id = ${feedbackId} order by t.created_at, t.id
  `;
  return { revision: meta?.revision ?? 0, tags: [...tags] };
}

export async function setPersonalFeedbackTags(tx: Db, ownerId: string, productId: string, feedbackId: string, tagIds: string[], expectedRevision: number) {
  const [f] = await tx`select 1 from feedback where id = ${feedbackId} and product_id = ${productId} and deleted_at is null`;
  if (!f) throw new AppError('NOT_FOUND');
  const ids = [...new Set(tagIds)];
  if (ids.length) {
    const own = await tx`select id from personal_tags where owner_id = ${ownerId} and product_id = ${productId} and id in ${tx(ids)}`;
    if (own.length !== ids.length) throw new AppError('NOT_FOUND');
  }
  const [meta] = await tx<{ revision: number }[]>`
    select revision from personal_feedback_metadata where owner_id = ${ownerId} and feedback_id = ${feedbackId} for update
  `;
  assertRevision(meta?.revision ?? 0, expectedRevision);
  let revision: number;
  if (!meta) {
    const inserted = await tx<{ revision: number }[]>`
      insert into personal_feedback_metadata (owner_id, product_id, feedback_id, revision) values (${ownerId}, ${productId}, ${feedbackId}, 1)
      on conflict do nothing returning revision
    `;
    if (!inserted[0]) throw new AppError('REVISION_CONFLICT');
    revision = 1;
  } else {
    const [r] = await tx<{ revision: number }[]>`
      update personal_feedback_metadata set revision = revision + 1 where owner_id = ${ownerId} and feedback_id = ${feedbackId} returning revision
    `;
    revision = r.revision;
  }
  await tx`delete from personal_feedback_tags where owner_id = ${ownerId} and feedback_id = ${feedbackId}`;
  for (const id of ids) {
    await tx`insert into personal_feedback_tags (owner_id, product_id, feedback_id, personal_tag_id) values (${ownerId}, ${productId}, ${feedbackId}, ${id})`;
  }
  return getPersonalFeedbackTags(tx, ownerId, productId, feedbackId).then((r) => ({ ...r, revision }));
}
