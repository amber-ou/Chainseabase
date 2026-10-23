import type { Db } from '@/server/db';
import { AppError } from '@/server/errors';
import { columnFor, type CardFacts, type ColumnDef, type Dimension } from './columns';
import { RANK_STEP } from './rank';

export interface RoadmapRow {
  id: string; productId: string; name: string; description: string; dimension: Dimension; tagGroupId: string | null;
  sortMode: 'create_time' | 'freedom'; ranksInitialized: boolean; isDefault: boolean; portalPublished: boolean;
  position: number; revision: number; createdAt: Date;
}

export interface FactsRow extends CardFacts { createdAt: Date }

export async function loadColumnDefs(db: Db, roadmapId: string) {
  return db<(ColumnDef & { label: string; position: number })[]>`
    select id, label, position, status_id, category_id, tag_id, is_unclassified
    from roadmap_columns where roadmap_id = ${roadmapId} order by position, id
  `;
}

/** Facts for all live feedback of a product (optionally public only or a subset). */
export async function loadFacts(db: Db, productId: string, tagGroupId: string | null, opts: { publicOnly?: boolean; feedbackIds?: string[] } = {}): Promise<FactsRow[]> {
  const rows = await db<{ id: string; statusId: string; categoryId: string; createdAt: Date; groupTagIds: string[] | null }[]>`
    select f.id, f.status_id, f.category_id, f.created_at,
      ${tagGroupId
        ? db`(select array_agg(ft.tag_id) from feedback_tags ft where ft.feedback_id = f.id and ft.group_id = ${tagGroupId})`
        : db`null::uuid[]`} as group_tag_ids
    from feedback f
    where f.product_id = ${productId} and f.deleted_at is null
    ${opts.publicOnly ? db`and f.visibility = 'public'` : db``}
    ${opts.feedbackIds ? db`and f.id in ${db(opts.feedbackIds)}` : db``}
  `;
  return rows.map((r) => ({ id: r.id, statusId: r.statusId, categoryId: r.categoryId, createdAt: r.createdAt, groupTagIds: r.groupTagIds ?? [] }));
}

export function columnOrThrow(card: CardFacts, dimension: Dimension, columns: ColumnDef[]): string {
  const r = columnFor(card, dimension, columns);
  if (!r.ok) {
    throw new AppError('DATA_INCONSISTENCY', r.reason === 'multiple_single_tags'
      ? '此 Feedback 在單選群組有多個標籤，已停止看板操作。'
      : '此 Feedback 找不到對應欄位，已停止看板操作。', { details: { feedbackId: card.id, reason: r.reason } });
  }
  return r.columnId;
}

/**
 * Keep explicit freedom ranks coherent after a card changes column through any
 * path: in every roadmap whose ranks are initialized the card goes to the top
 * of its (new) column; untouched cards keep their order.
 */
export async function placeFeedbackInRankedRoadmaps(tx: Db, productId: string, feedbackId: string, excludeRoadmapId?: string) {
  const roadmaps = await tx<RoadmapRow[]>`
    select id, dimension, tag_group_id from roadmaps where product_id = ${productId} and ranks_initialized
  `;
  for (const rm of roadmaps) {
    if (rm.id === excludeRoadmapId) continue;
    const [facts] = await loadFacts(tx, productId, rm.tagGroupId, { feedbackIds: [feedbackId] });
    if (!facts) continue;
    const columns = await loadColumnDefs(tx, rm.id);
    const columnId = columnOrThrow(facts, rm.dimension, columns);
    const [existing] = await tx<{ columnId: string }[]>`select column_id from roadmap_ranks where roadmap_id = ${rm.id} and feedback_id = ${feedbackId}`;
    if (existing?.columnId === columnId) continue;
    const [{ minRank }] = await tx<{ minRank: number | null }[]>`select min(rank) as min_rank from roadmap_ranks where column_id = ${columnId}`;
    const rank = minRank === null ? 0 : minRank - RANK_STEP;
    await tx`
      insert into roadmap_ranks (roadmap_id, feedback_id, column_id, rank) values (${rm.id}, ${feedbackId}, ${columnId}, ${rank})
      on conflict (roadmap_id, feedback_id) do update set column_id = excluded.column_id, rank = excluded.rank
    `;
  }
}

export async function removeFeedbackRanks(tx: Db, feedbackId: string) {
  await tx`delete from roadmap_ranks where feedback_id = ${feedbackId}`;
}
