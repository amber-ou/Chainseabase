import type { Db } from '@/server/db';

export type Dimension = 'status' | 'category' | 'tag_group';

export interface ColumnDef {
  id: string;
  statusId: string | null;
  categoryId: string | null;
  tagId: string | null;
  isUnclassified: boolean;
}

export interface CardFacts {
  id: string;
  statusId: string;
  categoryId: string;
  /** Tags of the roadmap's tag group carried by this feedback. */
  groupTagIds: string[];
}

export type ColumnResult = { ok: true; columnId: string } | { ok: false; reason: 'missing_column' | 'multiple_single_tags' };

/**
 * The unique-column function: every feedback maps to exactly one column of a
 * roadmap, derived only from its data value for the roadmap's dimension.
 * Corrupt data is reported, never resolved by "pick the first".
 */
export function columnFor(card: CardFacts, dimension: Dimension, columns: ColumnDef[]): ColumnResult {
  let matches: ColumnDef[];
  if (dimension === 'status') matches = columns.filter((c) => c.statusId === card.statusId);
  else if (dimension === 'category') matches = columns.filter((c) => c.categoryId === card.categoryId);
  else {
    if (card.groupTagIds.length > 1) return { ok: false, reason: 'multiple_single_tags' };
    matches = card.groupTagIds.length === 1
      ? columns.filter((c) => c.tagId === card.groupTagIds[0])
      : columns.filter((c) => c.isUnclassified);
  }
  if (matches.length !== 1) return { ok: false, reason: 'missing_column' };
  return { ok: true, columnId: matches[0].id };
}

/** Add a column for a new option to every roadmap of that dimension (same transaction). */
export async function addRoadmapColumnsForOption(
  tx: Db, productId: string, opt: { kind: 'status' | 'category' | 'tag'; optionId: string; label: string; groupId?: string },
) {
  const roadmaps = opt.kind === 'tag'
    ? await tx<{ id: string }[]>`select id from roadmaps where product_id = ${productId} and dimension = 'tag_group' and tag_group_id = ${opt.groupId!} for update`
    : await tx<{ id: string }[]>`select id from roadmaps where product_id = ${productId} and dimension = ${opt.kind} for update`;
  for (const rm of roadmaps) {
    const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(position), -1)::int + 1 as next from roadmap_columns where roadmap_id = ${rm.id}`;
    const label = opt.label.slice(0, 50);
    if (opt.kind === 'status') {
      await tx`insert into roadmap_columns (roadmap_id, product_id, label, position, status_id) values (${rm.id}, ${productId}, ${label}, ${next}, ${opt.optionId})`;
    } else if (opt.kind === 'category') {
      await tx`insert into roadmap_columns (roadmap_id, product_id, label, position, category_id) values (${rm.id}, ${productId}, ${label}, ${next}, ${opt.optionId})`;
    } else {
      await tx`insert into roadmap_columns (roadmap_id, product_id, label, position, tag_id) values (${rm.id}, ${productId}, ${label}, ${next}, ${opt.optionId})`;
    }
    await tx`update roadmaps set revision = revision + 1 where id = ${rm.id}`;
  }
}
