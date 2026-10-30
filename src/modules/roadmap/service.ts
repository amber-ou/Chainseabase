import type { Db } from '@/server/db';
import { AppError, assertRevision, invalid } from '@/server/errors';
import { iso } from '@/modules/shared/text';
import { loadFeedbackDtos, loadPublicFeedbackDtos, lockFeedback } from '@/modules/feedback/repo';
import { updateFeedback, type Actor } from '@/modules/feedback/service';
import { bumpProductRevision } from '@/modules/products/service';
import type { Dimension } from './columns';
import { columnOrThrow, loadColumnDefs, loadFacts, type FactsRow, type RoadmapRow } from './ranking';
import { rankBetween, resolveInsertIndex, sequentialRanks } from './rank';

export function roadmapDto(r: RoadmapRow & { tagGroupName?: string | null }) {
  return {
    id: r.id, name: r.name, description: r.description, dimension: r.dimension, tagGroupId: r.tagGroupId,
    tagGroupName: r.tagGroupName ?? null, sortMode: r.sortMode, isDefault: r.isDefault, portalPublished: r.portalPublished,
    position: r.position, revision: r.revision, createdAt: iso(r.createdAt),
  };
}

export async function listRoadmaps(db: Db, productId: string, opts: { publicOnly?: boolean } = {}) {
  const rows = await db<(RoadmapRow & { tagGroupName: string | null })[]>`
    select r.*, g.name as tag_group_name from roadmaps r left join tag_groups g on g.id = r.tag_group_id
    where r.product_id = ${productId}
    ${opts.publicOnly ? db`and r.portal_published and r.dimension = 'status'` : db``}
    order by r.position, r.created_at, r.id
  `;
  return rows.map(roadmapDto);
}

export async function getRoadmapRow(db: Db, productId: string, roadmapId: string, opts: { lock?: boolean; publicOnly?: boolean } = {}) {
  const rows = opts.lock
    ? await db<RoadmapRow[]>`select * from roadmaps where id = ${roadmapId} and product_id = ${productId} for update`
    : await db<RoadmapRow[]>`select * from roadmaps where id = ${roadmapId} and product_id = ${productId}`;
  const r = rows[0];
  if (!r || (opts.publicOnly && !(r.portalPublished && r.dimension === 'status'))) throw new AppError('NOT_FOUND');
  return r;
}

export async function createRoadmap(
  tx: Db, productId: string, input: { name: string; description: string; dimension: Dimension; tagGroupId: string | null },
) {
  if (input.dimension === 'tag_group') {
    if (!input.tagGroupId) throw invalid('請選擇單選 Tag 群組。', { tagGroupId: '必填' });
    const [g] = await tx<{ selectionMode: string }[]>`
      select selection_mode from tag_groups where id = ${input.tagGroupId} and product_id = ${productId} for share
    `;
    if (!g) throw invalid('Tag 群組不存在。', { tagGroupId: '群組不存在' });
    if (g.selectionMode !== 'single') throw invalid('只有單選 Tag 群組可以作為分欄維度。', { tagGroupId: '複選群組不適用' });
  } else if (input.tagGroupId) {
    throw invalid('只有 Tag 群組維度需要指定群組。', { tagGroupId: '此維度不需要群組' });
  }
  const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(position), -1)::int + 1 as next from roadmaps where product_id = ${productId}`;
  const [rm] = await tx<RoadmapRow[]>`
    insert into roadmaps (product_id, name, description, dimension, tag_group_id, position)
    values (${productId}, ${input.name}, ${input.description}, ${input.dimension}, ${input.tagGroupId}, ${next})
    returning *
  `;
  if (input.dimension === 'status') {
    await tx`
      insert into roadmap_columns (roadmap_id, product_id, label, position, status_id)
      select ${rm.id}, ${productId}, name, row_number() over (order by position, created_at, id) - 1, id
      from statuses where product_id = ${productId}
    `;
  } else if (input.dimension === 'category') {
    await tx`
      insert into roadmap_columns (roadmap_id, product_id, label, position, category_id)
      select ${rm.id}, ${productId}, name, row_number() over (order by position, created_at, id) - 1, id
      from categories where product_id = ${productId}
    `;
  } else {
    await tx`insert into roadmap_columns (roadmap_id, product_id, label, position, is_unclassified) values (${rm.id}, ${productId}, '未歸類', 0, true)`;
    await tx`
      insert into roadmap_columns (roadmap_id, product_id, label, position, tag_id)
      select ${rm.id}, ${productId}, name, row_number() over (order by position, created_at, id), id
      from tags where group_id = ${input.tagGroupId}
    `;
  }
  return roadmapDto(rm);
}

async function initializeRanks(tx: Db, productId: string, rm: RoadmapRow) {
  const columns = await loadColumnDefs(tx, rm.id);
  const facts = await loadFacts(tx, productId, rm.tagGroupId);
  const byColumn = new Map<string, FactsRow[]>();
  for (const c of columns) byColumn.set(c.id, []);
  for (const f of facts) byColumn.get(columnOrThrow(f, rm.dimension, columns))!.push(f);
  await tx`delete from roadmap_ranks where roadmap_id = ${rm.id}`;
  for (const [columnId, cards] of byColumn) {
    cards.sort(byCreatedDesc);
    const ranks = sequentialRanks(cards.length);
    for (let i = 0; i < cards.length; i++) {
      await tx`insert into roadmap_ranks (roadmap_id, feedback_id, column_id, rank) values (${rm.id}, ${cards[i].id}, ${columnId}, ${ranks[i]})`;
    }
  }
  await tx`update roadmaps set ranks_initialized = true where id = ${rm.id}`;
}

function byCreatedDesc(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) {
  const d = b.createdAt.getTime() - a.createdAt.getTime();
  return d !== 0 ? d : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

export async function updateRoadmap(
  tx: Db, productId: string, roadmapId: string,
  patch: { name?: string; description?: string; sortMode?: 'create_time' | 'freedom'; portalPublished?: boolean }, expectedRevision: number,
) {
  const rm = await getRoadmapRow(tx, productId, roadmapId, { lock: true });
  assertRevision(rm.revision, expectedRevision);
  if (patch.portalPublished && rm.dimension !== 'status') {
    throw invalid('第一版只有狀態看板可以發布到前台。', { portalPublished: '只限狀態看板' });
  }
  if (patch.sortMode === 'freedom' && !rm.ranksInitialized) await initializeRanks(tx, productId, rm);
  const [row] = await tx<RoadmapRow[]>`
    update roadmaps set
      name = ${patch.name ?? rm.name},
      description = ${patch.description ?? rm.description},
      sort_mode = ${patch.sortMode ?? rm.sortMode},
      portal_published = ${patch.portalPublished ?? rm.portalPublished},
      revision = revision + 1
    where id = ${roadmapId} returning *
  `;
  return roadmapDto(row);
}

export async function deleteRoadmap(tx: Db, productId: string, roadmapId: string, expectedRevision: number) {
  const rm = await getRoadmapRow(tx, productId, roadmapId, { lock: true });
  if (rm.isDefault) throw new AppError('ACTION_FORBIDDEN', '預設看板不可刪除。');
  assertRevision(rm.revision, expectedRevision);
  await tx`delete from roadmaps where id = ${roadmapId}`;
}

export async function reorderRoadmaps(tx: Db, productId: string, roadmapIds: string[], expectedProductRevision: number) {
  const productRevision = await bumpProductRevision(tx, productId, expectedProductRevision);
  const existing = (await tx<{ id: string }[]>`select id from roadmaps where product_id = ${productId}`).map((r) => r.id);
  if (new Set(roadmapIds).size !== roadmapIds.length || roadmapIds.length !== existing.length || !roadmapIds.every((id) => existing.includes(id))) {
    throw invalid('必須提供完整且不重複的看板順序。', { roadmapIds: '看板清單不完整' });
  }
  for (let i = 0; i < roadmapIds.length; i++) await tx`update roadmaps set position = ${i} where id = ${roadmapIds[i]}`;
  return { productRevision };
}

export async function updateColumnLabel(tx: Db, productId: string, roadmapId: string, columnId: string, label: string, expectedRevision: number) {
  const rm = await getRoadmapRow(tx, productId, roadmapId, { lock: true });
  assertRevision(rm.revision, expectedRevision);
  const [c] = await tx`update roadmap_columns set label = ${label} where id = ${columnId} and roadmap_id = ${roadmapId} returning id`;
  if (!c) throw new AppError('NOT_FOUND');
  const [r] = await tx<{ revision: number }[]>`update roadmaps set revision = revision + 1 where id = ${roadmapId} returning revision`;
  return { roadmapRevision: r.revision };
}

export async function reorderColumns(tx: Db, productId: string, roadmapId: string, columnIds: string[], expectedRevision: number) {
  const rm = await getRoadmapRow(tx, productId, roadmapId, { lock: true });
  assertRevision(rm.revision, expectedRevision);
  const existing = (await tx<{ id: string }[]>`select id from roadmap_columns where roadmap_id = ${roadmapId}`).map((r) => r.id);
  if (new Set(columnIds).size !== columnIds.length || columnIds.length !== existing.length || !columnIds.every((id) => existing.includes(id))) {
    throw invalid('必須提供完整且不重複的欄位順序。', { columnIds: '欄位清單不完整' });
  }
  for (let i = 0; i < columnIds.length; i++) await tx`update roadmap_columns set position = ${i} where id = ${columnIds[i]}`;
  const [r] = await tx<{ revision: number }[]>`update roadmaps set revision = revision + 1 where id = ${roadmapId} returning revision`;
  return { roadmapRevision: r.revision };
}

/** Full server-side assignment and ordering (counts never rely on loaded pages). */
async function computeBoard(db: Db, productId: string, rm: RoadmapRow, publicOnly: boolean) {
  const columns = await loadColumnDefs(db, rm.id);
  const facts = await loadFacts(db, productId, rm.tagGroupId, { publicOnly });
  const ranks = new Map(
    (await db<{ feedbackId: string; columnId: string; rank: number; placementRevision: number }[]>`
      select feedback_id, column_id, rank, placement_revision from roadmap_ranks where roadmap_id = ${rm.id}
    `).map((r) => [r.feedbackId, r]),
  );
  const byColumn = new Map<string, FactsRow[]>(columns.map((c) => [c.id, []]));
  for (const f of facts) byColumn.get(columnOrThrow(f, rm.dimension, columns))!.push(f);
  const ordered = new Map<string, string[]>();
  for (const [columnId, cards] of byColumn) {
    if (rm.sortMode === 'create_time') {
      ordered.set(columnId, [...cards].sort(byCreatedDesc).map((c) => c.id));
    } else {
      const unranked = cards.filter((c) => ranks.get(c.id)?.columnId !== columnId).sort(byCreatedDesc);
      const ranked = cards.filter((c) => ranks.get(c.id)?.columnId === columnId)
        .sort((a, b) => ranks.get(a.id)!.rank - ranks.get(b.id)!.rank || byCreatedDesc(a, b));
      ordered.set(columnId, [...unranked, ...ranked].map((c) => c.id));
    }
  }
  const placementRevision = (feedbackId: string) => ranks.get(feedbackId)?.placementRevision ?? 0;
  return { columns, ordered, ranks, placementRevision };
}

function offsetCursor(offset: number) { return Buffer.from(String(offset)).toString('base64url'); }
function readOffset(cursor?: string) {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export async function getBoard(
  db: Db, productId: string, roadmapId: string,
  opts: { limitPerColumn: number; publicOnly?: boolean; viewerId?: string | null; viewerCanInteract?: boolean; viewerIsTeam?: boolean },
) {
  const rm = await getRoadmapRow(db, productId, roadmapId, { publicOnly: opts.publicOnly });
  const { columns, ordered, placementRevision } = await computeBoard(db, productId, rm, Boolean(opts.publicOnly));
  const firstIds = columns.flatMap((c) => ordered.get(c.id)!.slice(0, opts.limitPerColumn));
  const cards = opts.publicOnly
    ? await loadPublicFeedbackDtos(db, productId, firstIds, opts.viewerId ?? null, Boolean(opts.viewerCanInteract), Boolean(opts.viewerIsTeam))
    : await loadFeedbackDtos(db, productId, firstIds);
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  return {
    roadmap: roadmapDto(rm),
    columns: columns.map((c) => {
      const ids = ordered.get(c.id)!;
      return {
        id: c.id,
        label: c.label,
        position: c.position,
        optionId: c.statusId ?? c.categoryId ?? c.tagId,
        isUnclassified: c.isUnclassified,
        count: ids.length,
        // internal boards carry each card's placement revision for optimistic move checks
        cards: ids.slice(0, opts.limitPerColumn).map((id) => cardMap.get(id)).filter(Boolean)
          .map((card) => (opts.publicOnly ? card : { ...card, placementRevision: placementRevision(card!.id) })),
        nextCursor: ids.length > opts.limitPerColumn ? offsetCursor(opts.limitPerColumn) : null,
      };
    }),
  };
}

export async function getColumnPage(
  db: Db, productId: string, roadmapId: string, columnId: string,
  opts: { cursor?: string; limit: number; publicOnly?: boolean; viewerId?: string | null; viewerCanInteract?: boolean; viewerIsTeam?: boolean },
) {
  const rm = await getRoadmapRow(db, productId, roadmapId, { publicOnly: opts.publicOnly });
  const { ordered, placementRevision } = await computeBoard(db, productId, rm, Boolean(opts.publicOnly));
  const ids = ordered.get(columnId);
  if (!ids) throw new AppError('NOT_FOUND');
  const offset = readOffset(opts.cursor);
  const pageIds = ids.slice(offset, offset + opts.limit);
  const items = opts.publicOnly
    ? await loadPublicFeedbackDtos(db, productId, pageIds, opts.viewerId ?? null, Boolean(opts.viewerCanInteract), Boolean(opts.viewerIsTeam))
    : await loadFeedbackDtos(db, productId, pageIds);
  return {
    items: opts.publicOnly ? items : items.map((card) => ({ ...card, placementRevision: placementRevision(card.id) })),
    total: ids.length, nextCursor: offset + opts.limit < ids.length ? offsetCursor(offset + opts.limit) : null,
  };
}

export interface MoveInput {
  feedbackId: string;
  targetColumnId: string;
  beforeFeedbackId: string | null;
  afterFeedbackId: string | null;
  /** Checked when the move changes the card's column (the Feedback field changes). */
  expectedFeedbackRevision: number;
  /** The card's placement revision on this board as last seen (0 when it has no explicit rank). */
  expectedPlacementRevision: number;
}

/**
 * One card move: changes only this roadmap's dimension (if the column differs)
 * and the order, atomically. Same-column moves never touch Feedback fields.
 *
 * Concurrency scope:
 * - board structure: moves do not require the board revision; they only bump it
 *   when they switch the board to freedom ordering (the first manual move);
 * - same card: the Feedback row lock plus expectedFeedbackRevision (cross-column)
 *   and expectedPlacementRevision (any move) reject a stale second writer with 409;
 * - different cards: the target column row is locked while the neighbours are
 *   validated and the rank is written, so moves of other cards never conflict;
 *   cards landing between the same two neighbours meanwhile are fine, only a neighbour
 *   that left the column or a pair that swapped order is a 409 (details.reason=order_changed).
 */
export async function moveCard(tx: Db, actor: Actor, productId: string, roadmapId: string, input: MoveInput) {
  const peek = await getRoadmapRow(tx, productId, roadmapId);
  // first manual move initializes ranks and flips the sort mode: exclusive board lock;
  // afterwards moves share the board lock and serialize per target column only
  const exclusive = !peek.ranksInitialized || peek.sortMode !== 'freedom';
  let rm = exclusive
    ? await getRoadmapRow(tx, productId, roadmapId, { lock: true })
    : await lockRoadmapShared(tx, productId, roadmapId);
  const fb = await lockFeedback(tx, productId, input.feedbackId);
  if (!fb) throw new AppError('NOT_FOUND');
  const columns = await loadColumnDefs(tx, rm.id);
  const target = columns.find((c) => c.id === input.targetColumnId);
  if (!target) throw new AppError('NOT_FOUND');
  // serialize writers into the same target column (neighbour validation + rank assignment);
  // lock order is always feedback row → column row
  await tx`select id from roadmap_columns where id = ${target.id} for update`;
  const [current] = await tx<{ placementRevision: number }[]>`
    select placement_revision from roadmap_ranks where roadmap_id = ${rm.id} and feedback_id = ${fb.id}
  `;
  if ((current?.placementRevision ?? 0) !== input.expectedPlacementRevision) {
    throw new AppError('REVISION_CONFLICT', '這張卡片剛被其他人移動，請重新載入看板後再操作。', { details: { reason: 'card_changed' } });
  }
  const [facts] = await loadFacts(tx, productId, rm.tagGroupId, { feedbackIds: [input.feedbackId] });
  const currentColumnId = columnOrThrow(facts, rm.dimension, columns);
  let feedbackRevision = fb.revision;
  if (currentColumnId !== target.id) {
    if (fb.revision !== input.expectedFeedbackRevision) {
      throw new AppError('REVISION_CONFLICT', '這筆 Feedback 剛被其他人修改，請重新載入看板後再操作。', { details: { reason: 'card_changed' } });
    }
    let patch: Parameters<typeof updateFeedback>[4];
    if (rm.dimension === 'status') patch = { statusId: target.statusId!, expectedRevision: fb.revision };
    else if (rm.dimension === 'category') patch = { categoryId: target.categoryId!, expectedRevision: fb.revision };
    else {
      const tags = (await tx<{ tagId: string; groupId: string | null }[]>`select tag_id, group_id from feedback_tags where feedback_id = ${fb.id}`);
      const kept = tags.filter((t) => t.groupId !== rm.tagGroupId).map((t) => t.tagId);
      patch = { tagIds: target.tagId ? [...kept, target.tagId] : kept, expectedRevision: fb.revision };
    }
    const updated = await updateFeedback(tx, actor, productId, fb.id, patch, rm.id);
    feedbackRevision = updated.revision;
  }
  if (!rm.ranksInitialized) {
    await initializeRanks(tx, productId, rm);
    rm = { ...rm, ranksInitialized: true };
  }
  const board = await computeBoard(tx, productId, { ...rm, sortMode: 'freedom' }, false);
  const order = board.ordered.get(target.id)!.filter((id) => id !== fb.id);
  const index = resolveInsertIndex(order, input, fb.id);
  if (index === 'invalid') {
    const neighbours = [input.beforeFeedbackId, input.afterFeedbackId].filter(Boolean) as string[];
    if (neighbours.includes(fb.id)) throw invalid('落點不能是卡片自己。', { beforeFeedbackId: '不能以自己為相鄰卡片' });
    const known = neighbours.length
      ? await tx`select id from feedback where product_id = ${productId} and deleted_at is null and id in ${tx(neighbours)}`
      : [];
    if (known.length !== neighbours.length) throw invalid('落點卡片不存在。', { beforeFeedbackId: '相鄰卡片不存在' });
    // the neighbours exist but left the column or swapped order: a real ordering conflict, never auto-applied
    throw new AppError('REVISION_CONFLICT', '欄位順序剛被其他人調整，請重新載入看板後再放置。', { details: { reason: 'order_changed' } });
  }
  const rankOf = (id: string | undefined) => {
    if (!id) return null;
    const r = board.ranks.get(id);
    return r && r.columnId === target.id ? r.rank : null;
  };
  const aboveId = index > 0 ? order[index - 1] : undefined;
  const belowId = order[index];
  const above = rankOf(aboveId);
  const below = rankOf(belowId);
  const rank = (aboveId && above === null) || (belowId && below === null) ? null : rankBetween(above, below);
  if (rank === null) {
    // renumber the whole target column with the moved card inserted (relative order of others unchanged)
    const full = [...order.slice(0, index), fb.id, ...order.slice(index)];
    const ranks = sequentialRanks(full.length);
    for (let i = 0; i < full.length; i++) {
      if (full[i] === fb.id) {
        await tx`
          insert into roadmap_ranks (roadmap_id, feedback_id, column_id, rank) values (${rm.id}, ${fb.id}, ${target.id}, ${ranks[i]})
          on conflict (roadmap_id, feedback_id) do update set column_id = excluded.column_id, rank = excluded.rank
        `;
      } else {
        // another card may have been moved out of this column concurrently (its own
        // transaction locks only its target column): never pull it back here
        await tx`
          insert into roadmap_ranks (roadmap_id, feedback_id, column_id, rank) values (${rm.id}, ${full[i]}, ${target.id}, ${ranks[i]})
          on conflict (roadmap_id, feedback_id) do update set rank = excluded.rank
          where roadmap_ranks.column_id = excluded.column_id
        `;
      }
    }
  } else {
    await tx`
      insert into roadmap_ranks (roadmap_id, feedback_id, column_id, rank) values (${rm.id}, ${fb.id}, ${target.id}, ${rank})
      on conflict (roadmap_id, feedback_id) do update set column_id = excluded.column_id, rank = excluded.rank
    `;
  }
  const [placed] = await tx<{ placementRevision: number }[]>`
    update roadmap_ranks set placement_revision = placement_revision + 1
    where roadmap_id = ${rm.id} and feedback_id = ${fb.id} returning placement_revision
  `;
  let roadmapRevision = rm.revision;
  if (rm.sortMode !== 'freedom') {
    const [r] = await tx<{ revision: number }[]>`update roadmaps set sort_mode = 'freedom', revision = revision + 1 where id = ${rm.id} returning revision`;
    roadmapRevision = r.revision;
  }
  return { roadmapRevision, feedbackRevision, placementRevision: placed.placementRevision, columnId: target.id, previousColumnId: currentColumnId };
}

async function lockRoadmapShared(tx: Db, productId: string, roadmapId: string) {
  const [r] = await tx<RoadmapRow[]>`select * from roadmaps where id = ${roadmapId} and product_id = ${productId} for share`;
  if (!r) throw new AppError('NOT_FOUND');
  return r;
}
