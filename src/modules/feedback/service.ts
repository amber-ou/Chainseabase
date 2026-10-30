import type { Db } from '@/server/db';
import { AppError, assertRevision, invalid } from '@/server/errors';
import { emitNotificationEvent } from '@/server/events';
import { decodeCursor, encodeCursor, likePattern } from '@/modules/shared/text';
import { loadFeedbackDto, loadFeedbackDtos, lockFeedback, type FeedbackDto, type Priority } from './repo';
import { createScheduleForFeedback, replayScheduleDraft, type DraftAction } from '@/modules/schedule/service';
import { placeFeedbackInRankedRoadmaps, removeFeedbackRanks } from '@/modules/roadmap/ranking';
import { syncPersonalPlacements } from '@/modules/personal/cleanup';

export interface Actor { id: string; displayName: string; avatarPath: string | null; googlePictureUrl: string | null; revision: number }

export interface ClassificationInput {
  statusId?: string;
  categoryId?: string;
  priority?: Priority;
  visibility?: 'internal' | 'public';
  tagIds?: string[];
  versionTagId?: string | null;
  personTagIds?: string[];
}

export interface CreateFeedbackInput extends ClassificationInput {
  title: string;
  description: string;
  scheduleDraft?: { actions: DraftAction[] };
}

async function defaultOption(tx: Db, table: 'statuses' | 'categories', productId: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`select id from ${tx(table)} where product_id = ${productId} and is_default`;
  if (!row) throw new AppError('DATA_INCONSISTENCY', '產品缺少預設分類。');
  return row.id;
}

async function assertOption(tx: Db, table: 'statuses' | 'categories', productId: string, id: string, field: string) {
  const rows = await tx`select 1 from ${tx(table)} where id = ${id} and product_id = ${productId}`;
  if (rows.length === 0) throw invalid('分類不屬於此產品。', { [field]: '選項不存在' });
}

interface TagInfo { id: string; groupId: string | null; selectionMode: 'single' | 'multiple' | null; systemKey: string | null }

/**
 * Compute the final general-tag set (version tag included) from a request.
 * Returns null when the request does not touch tags.
 */
export async function resolveTagSet(
  tx: Db, productId: string, input: { tagIds?: string[]; versionTagId?: string | null }, current: string[],
): Promise<string[] | null> {
  if (input.tagIds === undefined && input.versionTagId === undefined) return null;
  const base = input.tagIds !== undefined ? [...new Set(input.tagIds)] : [...current];
  const lookup = [...new Set([...base, ...(input.versionTagId ? [input.versionTagId] : [])])];
  const infos = lookup.length
    ? await tx<TagInfo[]>`
        select t.id, t.group_id, g.selection_mode, g.system_key
        from tags t left join tag_groups g on g.id = t.group_id
        where t.product_id = ${productId} and t.id in ${tx(lookup)}
      `
    : [];
  const info = new Map(infos.map((i) => [i.id, i]));
  for (const id of lookup) if (!info.has(id)) throw invalid('標籤不屬於此產品。', { tagIds: '包含無效的標籤' });
  let final = base;
  if (input.versionTagId !== undefined) {
    const versionInBase = base.filter((id) => info.get(id)!.systemKey === 'version');
    if (input.tagIds !== undefined && versionInBase.length > 0) {
      const consistent = input.versionTagId !== null && versionInBase.length === 1 && versionInBase[0] === input.versionTagId;
      if (!consistent) throw new AppError('SINGLE_SELECT_CONFLICT', '版本欄位與版本標籤不一致。', { fieldErrors: { versionTagId: '與標籤中的版本不一致' } });
    }
    if (input.versionTagId !== null && info.get(input.versionTagId)!.systemKey !== 'version') {
      throw invalid('所選標籤不是版本。', { versionTagId: '不是版本群組的標籤' });
    }
    final = base.filter((id) => info.get(id)!.systemKey !== 'version');
    if (input.versionTagId !== null) final.push(input.versionTagId);
  }
  const perGroup = new Map<string, number>();
  for (const id of final) {
    const i = info.get(id)!;
    if (i.groupId && i.selectionMode === 'single') perGroup.set(i.groupId, (perGroup.get(i.groupId) ?? 0) + 1);
  }
  for (const count of perGroup.values()) {
    if (count > 1) throw new AppError('SINGLE_SELECT_CONFLICT', '單選群組只能選一個標籤。', { fieldErrors: { tagIds: '單選群組只能選一個' } });
  }
  return final;
}

export async function applyTagSet(tx: Db, productId: string, feedbackId: string, final: string[]): Promise<boolean> {
  const current = (await tx<{ tagId: string }[]>`select tag_id from feedback_tags where feedback_id = ${feedbackId}`).map((r) => r.tagId);
  const toRemove = current.filter((id) => !final.includes(id));
  const toAdd = final.filter((id) => !current.includes(id));
  if (toRemove.length) await tx`delete from feedback_tags where feedback_id = ${feedbackId} and tag_id in ${tx(toRemove)}`;
  for (const id of toAdd) await tx`insert into feedback_tags (feedback_id, tag_id, product_id) values (${feedbackId}, ${id}, ${productId})`;
  return toRemove.length > 0 || toAdd.length > 0;
}

/** Active team members responsible through any of the given person tags. */
export async function responsibleMembers(tx: Db, personTagIds: string[]): Promise<string[]> {
  if (personTagIds.length === 0) return [];
  const rows = await tx<{ userId: string }[]>`
    select distinct upt.user_id from user_person_tags upt join users u on u.id = upt.user_id
    where upt.person_tag_id in ${tx(personTagIds)} and u.role = 'team' and u.membership_state = 'active'
  `;
  return rows.map((r) => r.userId);
}

async function applyPersonTags(tx: Db, productId: string, feedbackId: string, requested: string[]) {
  const ids = [...new Set(requested)];
  if (ids.length) {
    const found = await tx`select id from person_tags where product_id = ${productId} and id in ${tx(ids)}`;
    if (found.length !== ids.length) throw invalid('Person tag 不屬於此產品。', { personTagIds: '包含無效的 Person tag' });
  }
  const before = (await tx<{ personTagId: string }[]>`select person_tag_id from feedback_person_tags where feedback_id = ${feedbackId}`).map((r) => r.personTagId);
  const toRemove = before.filter((id) => !ids.includes(id));
  const toAdd = ids.filter((id) => !before.includes(id));
  const membersBefore = await responsibleMembers(tx, before);
  if (toRemove.length) await tx`delete from feedback_person_tags where feedback_id = ${feedbackId} and person_tag_id in ${tx(toRemove)}`;
  for (const id of toAdd) await tx`insert into feedback_person_tags (feedback_id, person_tag_id, product_id) values (${feedbackId}, ${id}, ${productId})`;
  const membersAfter = await responsibleMembers(tx, ids);
  const newlyResponsible = membersAfter.filter((u) => !membersBefore.includes(u));
  return { changed: toRemove.length > 0 || toAdd.length > 0, newlyResponsible };
}

export async function createFeedback(
  tx: Db, actor: Actor, productId: string, input: CreateFeedbackInput, source: 'admin' | 'portal',
): Promise<FeedbackDto> {
  const statusId = input.statusId ?? (await defaultOption(tx, 'statuses', productId));
  const categoryId = input.categoryId ?? (await defaultOption(tx, 'categories', productId));
  if (input.statusId) await assertOption(tx, 'statuses', productId, statusId, 'statusId');
  if (input.categoryId) await assertOption(tx, 'categories', productId, categoryId, 'categoryId');
  const visibility = input.visibility ?? (source === 'portal' ? 'public' : 'internal');
  const [fb] = await tx<{ id: string }[]>`
    insert into feedback (product_id, author_id, title, description, status_id, category_id, priority, visibility, source)
    values (${productId}, ${actor.id}, ${input.title}, ${input.description}, ${statusId}, ${categoryId},
            ${input.priority ?? 'P0'}, ${visibility}, ${source})
    returning id
  `;
  const tagSet = await resolveTagSet(tx, productId, { tagIds: input.tagIds ?? [], versionTagId: input.versionTagId }, []);
  if (tagSet) await applyTagSet(tx, productId, fb.id, tagSet);
  const people = await applyPersonTags(tx, productId, fb.id, input.personTagIds ?? []);
  await createScheduleForFeedback(tx, productId, fb.id, actor.id);
  if (input.scheduleDraft?.actions?.length) {
    await replayScheduleDraft(tx, actor, productId, fb.id, input.scheduleDraft.actions);
  }
  await placeFeedbackInRankedRoadmaps(tx, productId, fb.id);
  await emitNotificationEvent(tx, {
    productId, actorId: actor.id, feedbackId: fb.id, type: 'feedback.created',
    intents: people.newlyResponsible.map((recipientId) => ({ recipientId, reason: 'assigned' as const })),
  });
  return (await loadFeedbackDto(tx, productId, fb.id))!;
}

export interface UpdateFeedbackInput extends ClassificationInput {
  title?: string;
  description?: string;
  expectedRevision: number;
}

/**
 * Shared write path for every internal feedback edit (modal, roadmap, settings).
 * `placedByRoadmapId`: a roadmap move places the card on its own board itself.
 */
export async function updateFeedback(tx: Db, actor: Actor, productId: string, feedbackId: string, input: UpdateFeedbackInput, placedByRoadmapId?: string): Promise<FeedbackDto> {
  const current = await lockFeedback(tx, productId, feedbackId);
  if (!current) throw new AppError('NOT_FOUND');
  assertRevision(current.revision, input.expectedRevision);
  let classificationChanged = false;
  if (input.statusId !== undefined && input.statusId !== current.statusId) {
    await assertOption(tx, 'statuses', productId, input.statusId, 'statusId');
    await tx`update feedback set status_id = ${input.statusId} where id = ${feedbackId}`;
    classificationChanged = true;
  }
  if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
    await assertOption(tx, 'categories', productId, input.categoryId, 'categoryId');
    await tx`update feedback set category_id = ${input.categoryId} where id = ${feedbackId}`;
    classificationChanged = true;
  }
  if (input.title !== undefined) await tx`update feedback set title = ${input.title} where id = ${feedbackId}`;
  if (input.description !== undefined) await tx`update feedback set description = ${input.description} where id = ${feedbackId}`;
  if (input.priority !== undefined) await tx`update feedback set priority = ${input.priority} where id = ${feedbackId}`;
  if (input.visibility !== undefined) await tx`update feedback set visibility = ${input.visibility} where id = ${feedbackId}`;
  const currentTags = (await tx<{ tagId: string }[]>`select tag_id from feedback_tags where feedback_id = ${feedbackId}`).map((r) => r.tagId);
  const tagSet = await resolveTagSet(tx, productId, { tagIds: input.tagIds, versionTagId: input.versionTagId }, currentTags);
  if (tagSet && (await applyTagSet(tx, productId, feedbackId, tagSet))) classificationChanged = true;
  let newlyResponsible: string[] = [];
  if (input.personTagIds !== undefined) {
    const people = await applyPersonTags(tx, productId, feedbackId, input.personTagIds);
    newlyResponsible = people.newlyResponsible;
    if (people.changed) await syncPersonalPlacements(tx, productId);
  }
  await tx`update feedback set revision = revision + 1, updated_at = now() where id = ${feedbackId}`;
  if (classificationChanged) await placeFeedbackInRankedRoadmaps(tx, productId, feedbackId, placedByRoadmapId);
  await emitNotificationEvent(tx, {
    productId, actorId: actor.id, feedbackId, type: 'feedback.updated',
    intents: newlyResponsible.map((recipientId) => ({ recipientId, reason: 'assigned' as const })),
  });
  return (await loadFeedbackDto(tx, productId, feedbackId))!;
}

export async function softDeleteFeedback(tx: Db, actor: Actor, productId: string, feedbackId: string, expectedRevision: number) {
  const current = await lockFeedback(tx, productId, feedbackId);
  if (!current) throw new AppError('NOT_FOUND');
  assertRevision(current.revision, expectedRevision);
  await tx`update feedback set deleted_at = now(), deleted_by = ${actor.id}, revision = revision + 1 where id = ${feedbackId}`;
  await removeFeedbackRanks(tx, feedbackId);
  await syncPersonalPlacements(tx, productId);
}

export interface ListFilters {
  q?: string;
  statusId?: string;
  categoryId?: string;
  tagIds?: string[];
  authorId?: string;
  cursor?: string;
  limit: number;
  publicOnly?: boolean;
}

/** Shared filtered listing (created_at DESC, id DESC). Returns ids, total and status counts. */
export async function listFeedbackIds(db: Db, productId: string, f: ListFilters) {
  const cursor = decodeCursor(f.cursor);
  const q = f.q?.trim() ? likePattern(f.q.trim()) : null;
  const tagIds = f.tagIds ?? [];
  const where = (withStatus: boolean) => db`
    f.product_id = ${productId} and f.deleted_at is null
    ${f.publicOnly ? db`and f.visibility = 'public'` : db``}
    ${q ? db`and (f.title ilike ${q} or f.description ilike ${q})` : db``}
    ${withStatus && f.statusId ? db`and f.status_id = ${f.statusId}` : db``}
    ${f.categoryId ? db`and f.category_id = ${f.categoryId}` : db``}
    ${f.authorId ? db`and f.author_id = ${f.authorId}` : db``}
    ${tagIds.length ? db`and (select count(*) from feedback_tags ft where ft.feedback_id = f.id and ft.tag_id in ${db(tagIds)}) = ${tagIds.length}` : db``}
  `;
  const rows = await db<{ id: string; createdAt: Date }[]>`
    select f.id, f.created_at from feedback f
    where ${where(true)}
    ${cursor ? db`and (f.created_at, f.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : db``}
    order by f.created_at desc, f.id desc
    limit ${f.limit + 1}
  `;
  const [{ total }] = await db<{ total: number }[]>`select count(*)::int as total from feedback f where ${where(true)}`;
  const statusCounts = await db<{ statusId: string; count: number }[]>`
    select f.status_id, count(*)::int as count from feedback f where ${where(false)} group by f.status_id
  `;
  const page = rows.slice(0, f.limit);
  const nextCursor = rows.length > f.limit ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null;
  return { ids: page.map((r) => r.id), total, nextCursor, statusCounts: Object.fromEntries(statusCounts.map((s) => [s.statusId, s.count])) };
}

export async function listFeedback(db: Db, productId: string, f: ListFilters) {
  const res = await listFeedbackIds(db, productId, f);
  return { items: await loadFeedbackDtos(db, productId, res.ids), total: res.total, nextCursor: res.nextCursor, statusCounts: res.statusCounts };
}
