import type { Db } from '@/server/db';
import { AppError, assertRevision, invalid } from '@/server/errors';
import { likePattern } from '@/modules/shared/text';

/**
 * Shared Feedback views (2026-11-10, LIST-01..15; migration 0008). A view is a filter table of the admin
 * Feedback list: one status or one tag of the product, never changed after creation. Views, their order,
 * colours, sort modes and manual row orders belong to the product and are shared by its whole team.
 *
 * - Views never hold Feedback: rows are computed from the live Feedback each time (status / tags,
 *   not deleted), so one Feedback can appear in several views, and edits move it in or out at once.
 * - Concurrency: the product's list revision guards creating, reordering and removing views; each view's
 *   own revision guards its sort mode and row order. A stale revision answers 409 (nothing is changed).
 * - Removing a view deletes only the view and its row order; Feedback, statuses and tags are untouched.
 * - The first 新貼文 view (the product's default status) is made once; a removed view is not re-added.
 */
export type ViewColor = 'blue' | 'sand' | 'green' | 'lilac' | 'rose' | 'teal';
const COLORS: ViewColor[] = ['blue', 'sand', 'green', 'lilac', 'rose', 'teal'];

export interface ViewDto {
  id: string;
  kind: 'status' | 'tag';
  optionId: string;
  /** the option's current name (a renamed status or tag shows its new name) */
  label: string;
  /** the tag's group, when the view filters by a grouped tag */
  groupName: string | null;
  color: ViewColor;
  sortMode: 'created' | 'manual';
  revision: number;
}

interface ViewRow { id: string; statusId: string | null; tagId: string | null; color: ViewColor; sortMode: 'created' | 'manual'; revision: number; statusName: string | null; tagName: string | null; groupName: string | null }

const toDto = (r: ViewRow): ViewDto => ({
  id: r.id, kind: r.statusId ? 'status' : 'tag', optionId: (r.statusId ?? r.tagId)!,
  label: (r.statusName ?? r.tagName) ?? '', groupName: r.tagId ? r.groupName : null,
  color: r.color, sortMode: r.sortMode, revision: r.revision,
});

async function readViews(db: Db, productId: string) {
  const rows = await db<ViewRow[]>`
    select v.id, v.status_id, v.tag_id, v.color, v.sort_mode, v.revision, s.name as status_name, t.name as tag_name, g.name as group_name
    from feedback_views v
    left join statuses s on s.id = v.status_id
    left join tags t on t.id = v.tag_id
    left join tag_groups g on g.id = t.group_id
    where v.product_id = ${productId}
    order by v.position, v.created_at, v.id
  `;
  return rows.map(toDto);
}

/** The product's views, making the first 新貼文 view once (idempotent, safe under concurrent first visits). */
export async function listViews(tx: Db, productId: string, actorId: string) {
  await tx`insert into feedback_view_lists (product_id) values (${productId}) on conflict (product_id) do nothing`;
  const [list] = await tx<{ revision: number; nextColor: number; seededAt: Date | null }[]>`
    select revision, next_color, seeded_at from feedback_view_lists where product_id = ${productId} for update
  `;
  let revision = list.revision;
  if (!list.seededAt) {
    const [status] = await tx<{ id: string }[]>`select id from statuses where product_id = ${productId} and is_default`;
    if (status) {
      await tx`
        insert into feedback_views (product_id, status_id, color, position, created_by)
        values (${productId}, ${status.id}, ${COLORS[list.nextColor % COLORS.length]}, 0, ${actorId})
        on conflict do nothing
      `;
    }
    const [u] = await tx<{ revision: number }[]>`
      update feedback_view_lists set seeded_at = now(), next_color = next_color + 1, revision = revision + 1
      where product_id = ${productId} returning revision
    `;
    revision = u.revision;
  }
  return { revision, views: await readViews(tx, productId) };
}

async function lockList(tx: Db, productId: string, expectedRevision: number) {
  await tx`insert into feedback_view_lists (product_id) values (${productId}) on conflict (product_id) do nothing`;
  const [list] = await tx<{ revision: number; nextColor: number }[]>`
    select revision, next_color from feedback_view_lists where product_id = ${productId} for update
  `;
  assertRevision(list.revision, expectedRevision);
  return list;
}

async function bumpList(tx: Db, productId: string, extra = tx``) {
  const [u] = await tx<{ revision: number }[]>`
    update feedback_view_lists set revision = revision + 1 ${extra} where product_id = ${productId} returning revision
  `;
  return u.revision;
}

/** LIST-05: a new view for one status or one tag of this product, at the end, with the next colour. */
export async function createView(tx: Db, actorId: string, productId: string, input: { kind: 'status' | 'tag'; optionId: string; expectedRevision: number }) {
  const list = await lockList(tx, productId, input.expectedRevision);
  const table = input.kind === 'status' ? 'statuses' : 'tags';
  const [option] = await tx`select id from ${tx(table)} where id = ${input.optionId} and product_id = ${productId}`;
  if (!option) throw invalid(input.kind === 'status' ? '狀態不存在。' : '標籤不存在。', { optionId: '選項不存在' });
  const [dup] = await tx`
    select 1 from feedback_views where product_id = ${productId}
      and ${input.kind === 'status' ? tx`status_id` : tx`tag_id`} = ${input.optionId}
  `;
  if (dup) throw invalid('已有相同條件的表格。', { optionId: '已有相同條件的表格' });
  const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(position), -1)::int + 1 as next from feedback_views where product_id = ${productId}`;
  const [row] = await tx<{ id: string }[]>`
    insert into feedback_views (product_id, status_id, tag_id, color, position, created_by)
    values (${productId}, ${input.kind === 'status' ? input.optionId : null}, ${input.kind === 'tag' ? input.optionId : null},
            ${COLORS[list.nextColor % COLORS.length]}, ${next}, ${actorId})
    returning id
  `;
  const revision = await bumpList(tx, productId, tx`, next_color = next_color + 1`);
  const views = await readViews(tx, productId);
  return { revision, view: views.find((v) => v.id === row.id)!, views };
}

/** LIST-08: remove a view and its row order only. */
export async function removeView(tx: Db, productId: string, viewId: string, expectedRevision: number) {
  await lockList(tx, productId, expectedRevision);
  const [v] = await tx`delete from feedback_views where id = ${viewId} and product_id = ${productId} returning id`;
  if (!v) throw new AppError('NOT_FOUND');
  return { revision: await bumpList(tx, productId), views: await readViews(tx, productId) };
}

/** LIST-09: the order of the product's views; the list must name exactly its current views. */
export async function reorderViews(tx: Db, productId: string, viewIds: string[], expectedRevision: number) {
  await lockList(tx, productId, expectedRevision);
  const current = (await tx<{ id: string }[]>`select id from feedback_views where product_id = ${productId}`).map((r) => r.id);
  if (viewIds.length !== current.length || new Set(viewIds).size !== viewIds.length || !viewIds.every((id) => current.includes(id))) {
    throw invalid('表格清單已變更，請重新載入。', { viewIds: '與目前的表格不一致' });
  }
  for (const [position, id] of viewIds.entries()) await tx`update feedback_views set position = ${position} where id = ${id}`;
  return { revision: await bumpList(tx, productId), views: await readViews(tx, productId) };
}

async function lockView(tx: Db, productId: string, viewId: string) {
  const [v] = await tx<{ id: string; statusId: string | null; tagId: string | null; sortMode: 'created' | 'manual'; revision: number }[]>`
    select id, status_id, tag_id, sort_mode, revision from feedback_views where id = ${viewId} and product_id = ${productId} for update
  `;
  if (!v) throw new AppError('NOT_FOUND');
  return v;
}

/** The view's own condition (a status, or a tag on the Feedback), on live Feedback of the product. */
function condition(db: Db, v: { statusId: string | null; tagId: string | null }) {
  return v.statusId
    ? db`f.status_id = ${v.statusId}`
    : db`exists (select 1 from feedback_tags ft where ft.feedback_id = f.id and ft.tag_id = ${v.tagId})`;
}

export interface ViewItemFilters { q?: string; categoryId?: string; tagIds?: string[]; offset: number; limit: number }

/**
 * LIST-07/11/14: the Feedback of one view, intersected with the page's search and filters, in the view's
 * order: by creation time (newest first, id as the stable tie-break), or in manual mode the ranked rows
 * after the not-yet-ranked ones (newer Feedback, newest first). The total counts every match, not only
 * the page; paging is by offset.
 */
export async function listViewItems(db: Db, productId: string, viewId: string, f: ViewItemFilters) {
  const [v] = await db<{ statusId: string | null; tagId: string | null; sortMode: 'created' | 'manual' }[]>`
    select status_id, tag_id, sort_mode from feedback_views where id = ${viewId} and product_id = ${productId}
  `;
  if (!v) throw new AppError('NOT_FOUND');
  const q = f.q?.trim() ? likePattern(f.q.trim()) : null;
  const tagIds = f.tagIds ?? [];
  const where = db`
    f.product_id = ${productId} and f.deleted_at is null and ${condition(db, v)}
    ${q ? db`and (f.title ilike ${q} or f.description ilike ${q})` : db``}
    ${f.categoryId ? db`and f.category_id = ${f.categoryId}` : db``}
    ${tagIds.length ? db`and (select count(*) from feedback_tags ft where ft.feedback_id = f.id and ft.tag_id in ${db(tagIds)}) = ${tagIds.length}` : db``}
  `;
  const rows = await db<{ id: string }[]>`
    select f.id from feedback f
    left join feedback_view_ranks r on r.view_id = ${viewId} and r.feedback_id = f.id
    where ${where}
    order by ${v.sortMode === 'manual' ? db`(r.rank is not null), r.rank,` : db``} f.created_at desc, f.id desc
    offset ${f.offset} limit ${f.limit + 1}
  `;
  const [{ total }] = await db<{ total: number }[]>`select count(*)::int as total from feedback f where ${where}`;
  const page = rows.slice(0, f.limit);
  return { ids: page.map((r) => r.id), total, nextCursor: rows.length > f.limit ? String(f.offset + f.limit) : null };
}

/**
 * LIST-10: move one Feedback within one view (never across views): it is placed before `beforeId`, or
 * last when `beforeId` is null. The whole view's order is kept (search and filters do not drop rows
 * that are not shown) and the view switches to manual order. Other views, Roadmap and Personal are
 * untouched. Both ids must currently match the view.
 */
export async function moveViewItem(tx: Db, productId: string, viewId: string, input: { feedbackId: string; beforeId: string | null; expectedRevision: number }) {
  const v = await lockView(tx, productId, viewId);
  assertRevision(v.revision, input.expectedRevision);
  const all = (await tx<{ id: string }[]>`
    select f.id from feedback f
    left join feedback_view_ranks r on r.view_id = ${viewId} and r.feedback_id = f.id
    where f.product_id = ${productId} and f.deleted_at is null and ${condition(tx, v)}
    order by ${v.sortMode === 'manual' ? tx`(r.rank is not null), r.rank,` : tx``} f.created_at desc, f.id desc
  `).map((r) => r.id);
  if (!all.includes(input.feedbackId)) throw invalid('這筆 Feedback 不在此表格中，不能移入。', { feedbackId: '不在此表格' });
  if (input.beforeId !== null && (!all.includes(input.beforeId) || input.beforeId === input.feedbackId)) {
    throw invalid('目標位置不在此表格中。', { beforeId: '不在此表格' });
  }
  const rest = all.filter((id) => id !== input.feedbackId);
  const at = input.beforeId === null ? rest.length : rest.indexOf(input.beforeId);
  rest.splice(at, 0, input.feedbackId);
  await tx`delete from feedback_view_ranks where view_id = ${viewId}`;
  if (rest.length) {
    await tx`insert into feedback_view_ranks ${tx(rest.map((id, rank) => ({ view_id: viewId, feedback_id: id, rank })))}`;
  }
  const [u] = await tx<{ revision: number }[]>`update feedback_views set sort_mode = 'manual', revision = revision + 1 where id = ${viewId} returning revision`;
  return { revision: u.revision, sortMode: 'manual' as const };
}

/** LIST-11: back to creation time (newest first); the manual order of this view is dropped. */
export async function sortViewByCreated(tx: Db, productId: string, viewId: string, expectedRevision: number) {
  const v = await lockView(tx, productId, viewId);
  assertRevision(v.revision, expectedRevision);
  await tx`delete from feedback_view_ranks where view_id = ${viewId}`;
  const [u] = await tx<{ revision: number }[]>`update feedback_views set sort_mode = 'created', revision = revision + 1 where id = ${viewId} returning revision`;
  return { revision: u.revision, sortMode: 'created' as const };
}

/** Product deletion: the product's views, their orders and its list row. */
export async function deleteViewsOfProduct(tx: Db, productId: string) {
  await tx`delete from feedback_views where product_id = ${productId}`;
  await tx`delete from feedback_view_lists where product_id = ${productId}`;
}
