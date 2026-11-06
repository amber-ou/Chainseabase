import type { Db } from '@/server/db';
import { AppError, invalid } from '@/server/errors';
import { bumpProductRevision } from './service';
import { addRoadmapColumnsForOption } from '@/modules/roadmap/columns';
import { syncPersonalPlacements } from '@/modules/personal/cleanup';

export type OptionKind = 'status' | 'category';

export interface OptionDto { id: string; name: string; position: number; isDefault: boolean }
export interface TagDto { id: string; name: string; groupId: string | null; position: number }
export interface TagGroupDto {
  id: string; name: string; selectionMode: 'single' | 'multiple'; systemKey: 'version' | null; position: number; tags: TagDto[];
}
export interface TaxonomyDto {
  productRevision: number;
  statuses: OptionDto[];
  categories: OptionDto[];
  tagGroups: TagGroupDto[];
  ungroupedTags: TagDto[];
  personTags: { id: string; name: string; position: number }[];
}

const TABLE: Record<OptionKind, 'statuses' | 'categories'> = { status: 'statuses', category: 'categories' };
const FEEDBACK_COL: Record<OptionKind, 'status_id' | 'category_id'> = { status: 'status_id', category: 'category_id' };

export async function getTaxonomy(db: Db, productId: string): Promise<TaxonomyDto> {
  const [p] = await db<{ revision: number }[]>`select revision from products where id = ${productId}`;
  if (!p) throw new AppError('NOT_FOUND');
  const statuses = await db<OptionDto[]>`select id, name, position, is_default from statuses where product_id = ${productId} order by position, created_at, id`;
  const categories = await db<OptionDto[]>`select id, name, position, is_default from categories where product_id = ${productId} order by position, created_at, id`;
  const groups = await db<Omit<TagGroupDto, 'tags'>[]>`
    select id, name, selection_mode, system_key, position from tag_groups where product_id = ${productId}
    order by (system_key is null), position, created_at, id
  `;
  const tags = await db<TagDto[]>`select id, name, group_id, position from tags where product_id = ${productId} order by position, created_at, id`;
  const personTags = await db<{ id: string; name: string; position: number }[]>`
    select id, name, position from person_tags where product_id = ${productId} order by position, created_at, id
  `;
  return {
    productRevision: p.revision,
    statuses: [...statuses],
    categories: [...categories],
    tagGroups: groups.map((g) => ({ ...g, tags: tags.filter((t) => t.groupId === g.id) })),
    ungroupedTags: tags.filter((t) => t.groupId === null),
    personTags: [...personTags],
  };
}

async function nextPosition(tx: Db, table: string, productId: string): Promise<number> {
  const [r] = await tx<{ next: number }[]>`select coalesce(max(position), -1)::int + 1 as next from ${tx(table)} where product_id = ${productId}`;
  return r.next;
}

async function assertNameFree(tx: Db, table: string, productId: string, name: string, exceptId?: string, groupId?: string | null) {
  const rows = groupId === undefined
    ? await tx`select id from ${tx(table)} where product_id = ${productId} and name = ${name}`
    : await tx`select id from ${tx(table)} where product_id = ${productId} and name = ${name} and group_id is not distinct from ${groupId}`;
  if (rows.some((r) => r.id !== exceptId)) throw invalid('名稱已存在。', { name: '名稱已存在' });
}

// ---------------------------------------------------------------------------
// Status / category
// ---------------------------------------------------------------------------

export async function createOption(tx: Db, productId: string, kind: OptionKind, name: string, expectedRevision: number) {
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  const table = TABLE[kind];
  await assertNameFree(tx, table, productId, name);
  const position = await nextPosition(tx, table, productId);
  const [row] = await tx<OptionDto[]>`
    insert into ${tx(table)} (product_id, name, position) values (${productId}, ${name}, ${position})
    returning id, name, position, is_default
  `;
  // every roadmap of this dimension gets the new column in the same transaction
  await addRoadmapColumnsForOption(tx, productId, { kind, optionId: row.id, label: name });
  return { option: row, productRevision };
}

export async function updateOption(
  tx: Db, productId: string, kind: OptionKind, id: string,
  patch: { name?: string; position?: number; isDefault?: boolean }, expectedRevision: number,
) {
  const table = TABLE[kind];
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  const [existing] = await tx<{ id: string }[]>`select id from ${tx(table)} where id = ${id} and product_id = ${productId}`;
  if (!existing) throw new AppError('NOT_FOUND');
  if (patch.name !== undefined) {
    await assertNameFree(tx, table, productId, patch.name, id);
    await tx`update ${tx(table)} set name = ${patch.name} where id = ${id}`;
  }
  if (patch.position !== undefined) await tx`update ${tx(table)} set position = ${patch.position} where id = ${id}`;
  if (patch.isDefault === true) {
    await tx`update ${tx(table)} set is_default = false where product_id = ${productId} and is_default and id <> ${id}`;
    await tx`update ${tx(table)} set is_default = true where id = ${id}`;
  } else if (patch.isDefault === false) {
    throw invalid('請改為將其他選項設為預設。', { isDefault: '必須保留一個預設值' });
  }
  const [row] = await tx<OptionDto[]>`select id, name, position, is_default from ${tx(table)} where id = ${id}`;
  return { option: row, productRevision };
}

export async function optionUsage(db: Db, productId: string, kind: OptionKind, id: string) {
  const table = TABLE[kind];
  const col = FEEDBACK_COL[kind];
  const [opt] = await db`select id from ${db(table)} where id = ${id} and product_id = ${productId}`;
  if (!opt) throw new AppError('NOT_FOUND');
  const [{ count }] = await db<{ count: number }[]>`
    select count(*)::int as count from feedback where product_id = ${productId} and ${db(col)} = ${id} and deleted_at is null
  `;
  const roadmaps = await db<{ id: string; name: string }[]>`
    select distinct r.id, r.name from roadmap_columns c join roadmaps r on r.id = c.roadmap_id
    where c.${db(col)} = ${id}
  `;
  return { feedbackCount: count, roadmaps: [...roadmaps] };
}

export async function deleteOption(
  tx: Db, productId: string, kind: OptionKind, id: string,
  opts: { replacementId?: string | null }, expectedRevision: number,
) {
  const table = TABLE[kind];
  const col = FEEDBACK_COL[kind];
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  const [opt] = await tx<{ id: string; isDefault: boolean }[]>`select id, is_default from ${tx(table)} where id = ${id} and product_id = ${productId}`;
  if (!opt) throw new AppError('NOT_FOUND');
  const [{ total }] = await tx<{ total: number }[]>`select count(*)::int as total from ${tx(table)} where product_id = ${productId}`;
  if (total <= 1) throw new AppError('REFERENCE_IN_USE', '必須保留至少一個選項。');
  // count including soft-deleted rows: the FK must stay valid for them too
  const [{ used }] = await tx<{ used: number }[]>`select count(*)::int as used from feedback where product_id = ${productId} and ${tx(col)} = ${id}`;
  const replacementId = opts.replacementId ?? null;
  if ((used > 0 || opt.isDefault) && !replacementId) {
    const usage = await optionUsage(tx, productId, kind, id);
    throw new AppError('REFERENCE_IN_USE', '此選項仍被使用或為預設值，請指定替代選項。', { details: usage });
  }
  if (replacementId) {
    if (replacementId === id) throw invalid('替代選項不可為自己。', { replacementId: '請選擇其他選項' });
    const [rep] = await tx`select id from ${tx(table)} where id = ${replacementId} and product_id = ${productId}`;
    if (!rep) throw invalid('替代選項不存在。', { replacementId: '替代選項不存在' });
    await tx`
      update feedback set ${tx(col)} = ${replacementId}, revision = revision + 1, updated_at = now()
      where product_id = ${productId} and ${tx(col)} = ${id}
    `;
    if (opt.isDefault) {
      await tx`update ${tx(table)} set is_default = false where id = ${id}`;
      await tx`update ${tx(table)} set is_default = true where id = ${replacementId}`;
    }
  }
  // roadmap columns bound to this option cascade; their ranks cascade too
  await tx`delete from ${tx(table)} where id = ${id}`;
  return { productRevision };
}

// ---------------------------------------------------------------------------
// Tag groups and tags
// ---------------------------------------------------------------------------

export async function createTagGroup(tx: Db, productId: string, input: { name: string; selectionMode: 'single' | 'multiple' }, expectedRevision: number) {
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  await assertNameFree(tx, 'tag_groups', productId, input.name);
  const position = await nextPosition(tx, 'tag_groups', productId);
  const [g] = await tx<Omit<TagGroupDto, 'tags'>[]>`
    insert into tag_groups (product_id, name, selection_mode, position)
    values (${productId}, ${input.name}, ${input.selectionMode}, ${position})
    returning id, name, selection_mode, system_key, position
  `;
  return { group: { ...g, tags: [] }, productRevision };
}

export async function updateTagGroup(
  tx: Db, productId: string, id: string,
  patch: { name?: string; selectionMode?: 'single' | 'multiple' }, expectedRevision: number,
) {
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  const [g] = await tx<{ id: string; selectionMode: string; systemKey: string | null }[]>`
    select id, selection_mode, system_key from tag_groups where id = ${id} and product_id = ${productId} for update
  `;
  if (!g) throw new AppError('NOT_FOUND');
  if (patch.name !== undefined) {
    await assertNameFree(tx, 'tag_groups', productId, patch.name, id);
    await tx`update tag_groups set name = ${patch.name} where id = ${id}`;
  }
  if (patch.selectionMode && patch.selectionMode !== g.selectionMode) {
    if (g.systemKey === 'version') throw new AppError('ACTION_FORBIDDEN', '版本群組固定為單選。');
    if (patch.selectionMode === 'single') {
      const conflicts = await tx<{ feedbackId: string }[]>`
        select ft.feedback_id from feedback_tags ft where ft.group_id = ${id}
        group by ft.feedback_id having count(*) > 1
      `;
      if (conflicts.length > 0) {
        throw new AppError('SINGLE_SELECT_CONFLICT', `有 ${conflicts.length} 筆 Feedback 在此群組選了多個標籤，請先處理。`, {
          details: { conflictCount: conflicts.length, feedbackIds: conflicts.slice(0, 50).map((c) => c.feedbackId) },
        });
      }
    } else {
      const used = await tx<{ id: string; name: string }[]>`select id, name from roadmaps where tag_group_id = ${id}`;
      if (used.length > 0) {
        throw new AppError('REFERENCE_IN_USE', '此群組被 Roadmap 用作分欄維度，不能改為複選。', { details: { roadmaps: [...used] } });
      }
    }
    await tx`update tag_groups set selection_mode = ${patch.selectionMode} where id = ${id}`;
  }
  const [row] = await tx<Omit<TagGroupDto, 'tags'>[]>`select id, name, selection_mode, system_key, position from tag_groups where id = ${id}`;
  const tags = await tx<TagDto[]>`select id, name, group_id, position from tags where group_id = ${id} order by position, created_at, id`;
  return { group: { ...row, tags: [...tags] }, productRevision };
}

export async function deleteTagGroup(tx: Db, productId: string, id: string, opts: { strategy?: 'detach' }, expectedRevision: number) {
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  const [g] = await tx<{ systemKey: string | null }[]>`select system_key from tag_groups where id = ${id} and product_id = ${productId} for update`;
  if (!g) throw new AppError('NOT_FOUND');
  if (g.systemKey === 'version') throw new AppError('ACTION_FORBIDDEN', '版本群組不可移除。');
  const roadmaps = await tx<{ id: string; name: string }[]>`select id, name from roadmaps where tag_group_id = ${id}`;
  if (roadmaps.length > 0) throw new AppError('REFERENCE_IN_USE', '此群組被 Roadmap 使用，請先刪除該看板。', { details: { roadmaps: [...roadmaps] } });
  const [{ count }] = await tx<{ count: number }[]>`select count(distinct feedback_id)::int as count from feedback_tags where group_id = ${id}`;
  if (count > 0 && opts.strategy !== 'detach') {
    throw new AppError('REFERENCE_IN_USE', `有 ${count} 筆 Feedback 使用此群組的標籤，確認後將解除關聯。`, { details: { feedbackCount: count } });
  }
  await tx`
    update feedback set revision = revision + 1, updated_at = now()
    where id in (select feedback_id from feedback_tags where group_id = ${id})
  `;
  await tx`delete from tag_groups where id = ${id}`;
  return { productRevision };
}

export async function createTag(tx: Db, productId: string, input: { name: string; groupId: string | null }, expectedRevision: number) {
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  if (input.groupId) {
    const [g] = await tx`select id from tag_groups where id = ${input.groupId} and product_id = ${productId} for update`;
    if (!g) throw invalid('群組不存在。', { groupId: '群組不存在' });
  }
  await assertNameFree(tx, 'tags', productId, input.name, undefined, input.groupId);
  const [{ next }] = await tx<{ next: number }[]>`
    select coalesce(max(position), -1)::int + 1 as next from tags where product_id = ${productId} and group_id is not distinct from ${input.groupId}
  `;
  const [tag] = await tx<TagDto[]>`
    insert into tags (product_id, group_id, name, position) values (${productId}, ${input.groupId}, ${input.name}, ${next})
    returning id, name, group_id, position
  `;
  if (input.groupId) await addRoadmapColumnsForOption(tx, productId, { kind: 'tag', optionId: tag.id, label: input.name, groupId: input.groupId });
  return { tag, productRevision };
}

export async function updateTag(tx: Db, productId: string, id: string, patch: { name?: string; position?: number }, expectedRevision: number) {
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  const [t] = await tx<{ groupId: string | null }[]>`select group_id from tags where id = ${id} and product_id = ${productId}`;
  if (!t) throw new AppError('NOT_FOUND');
  if (patch.name !== undefined) {
    await assertNameFree(tx, 'tags', productId, patch.name, id, t.groupId);
    // rename keeps the ID; roadmap column labels are independent display names
    await tx`update tags set name = ${patch.name} where id = ${id}`;
  }
  if (patch.position !== undefined) await tx`update tags set position = ${patch.position} where id = ${id}`;
  const [tag] = await tx<TagDto[]>`select id, name, group_id, position from tags where id = ${id}`;
  return { tag, productRevision };
}

export async function tagUsage(db: Db, productId: string, id: string) {
  const [t] = await db`select id from tags where id = ${id} and product_id = ${productId}`;
  if (!t) throw new AppError('NOT_FOUND');
  const [{ count }] = await db<{ count: number }[]>`
    select count(*)::int as count from feedback_tags ft join feedback f on f.id = ft.feedback_id
    where ft.tag_id = ${id} and f.deleted_at is null
  `;
  const roadmaps = await db<{ id: string; name: string }[]>`
    select distinct r.id, r.name from roadmap_columns c join roadmaps r on r.id = c.roadmap_id where c.tag_id = ${id}
  `;
  return { feedbackCount: count, roadmaps: [...roadmaps] };
}

export async function deleteTag(
  tx: Db, productId: string, id: string,
  opts: { replacementId?: string | null; strategy?: 'detach' }, expectedRevision: number,
) {
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  const [t] = await tx<{ groupId: string | null }[]>`select group_id from tags where id = ${id} and product_id = ${productId}`;
  if (!t) throw new AppError('NOT_FOUND');
  const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from feedback_tags where tag_id = ${id}`;
  if (count > 0 && !opts.replacementId && opts.strategy !== 'detach') {
    throw new AppError('REFERENCE_IN_USE', '此標籤仍被使用，請指定替代標籤或確認解除關聯。', { details: await tagUsage(tx, productId, id) });
  }
  if (opts.replacementId) {
    const [rep] = await tx<{ groupId: string | null }[]>`select group_id from tags where id = ${opts.replacementId} and product_id = ${productId}`;
    if (!rep || opts.replacementId === id) throw invalid('替代標籤無效。', { replacementId: '替代標籤無效' });
    if (rep.groupId !== t.groupId) throw invalid('替代標籤必須屬於同一群組。', { replacementId: '必須屬於同一群組' });
    await tx`
      insert into feedback_tags (feedback_id, tag_id, product_id)
      select ft.feedback_id, ${opts.replacementId}, ft.product_id from feedback_tags ft
      where ft.tag_id = ${id}
        and not exists (select 1 from feedback_tags x where x.feedback_id = ft.feedback_id and x.tag_id = ${opts.replacementId})
    `;
  }
  await tx`
    update feedback set revision = revision + 1, updated_at = now()
    where id in (select feedback_id from feedback_tags where tag_id = ${id})
  `;
  // feedback_tags and roadmap columns referencing the tag cascade; cards fall to 未歸類
  await tx`delete from feedback_tags where tag_id = ${id}`;
  await tx`delete from tags where id = ${id}`;
  return { productRevision };
}

// ---------------------------------------------------------------------------
// Person tags
// ---------------------------------------------------------------------------

export async function createPersonTag(tx: Db, productId: string, name: string, expectedRevision: number) {
  if (name === '未安排') throw invalid('「未安排」是保留選項。', { name: '保留名稱' });
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  await assertNameFree(tx, 'person_tags', productId, name);
  const position = await nextPosition(tx, 'person_tags', productId);
  const [row] = await tx<{ id: string; name: string; position: number }[]>`
    insert into person_tags (product_id, name, position) values (${productId}, ${name}, ${position}) returning id, name, position
  `;
  return { personTag: row, productRevision };
}

export async function updatePersonTag(tx: Db, productId: string, id: string, name: string, expectedRevision: number) {
  if (name === '未安排') throw invalid('「未安排」是保留選項。', { name: '保留名稱' });
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  const [t] = await tx`select id from person_tags where id = ${id} and product_id = ${productId}`;
  if (!t) throw new AppError('NOT_FOUND');
  await assertNameFree(tx, 'person_tags', productId, name, id);
  const [row] = await tx<{ id: string; name: string; position: number }[]>`
    update person_tags set name = ${name} where id = ${id} returning id, name, position
  `;
  return { personTag: row, productRevision };
}

export async function personTagUsage(db: Db, productId: string, id: string) {
  const [t] = await db`select id from person_tags where id = ${id} and product_id = ${productId}`;
  if (!t) throw new AppError('NOT_FOUND');
  const [{ feedbackCount }] = await db<{ feedbackCount: number }[]>`
    select count(*)::int as feedback_count from feedback_person_tags fpt join feedback f on f.id = fpt.feedback_id
    where fpt.person_tag_id = ${id} and f.deleted_at is null
  `;
  const [{ userCount }] = await db<{ userCount: number }[]>`select count(*)::int as user_count from user_person_tags where person_tag_id = ${id}`;
  return { feedbackCount, userCount, roadmaps: [] };
}

export async function deletePersonTag(tx: Db, productId: string, id: string, opts: { strategy?: 'detach' }, expectedRevision: number) {
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  const usage = await personTagUsage(tx, productId, id);
  if ((usage.feedbackCount > 0 || usage.userCount > 0) && opts.strategy !== 'detach') {
    throw new AppError('REFERENCE_IN_USE', '此職掌仍被成員或 Feedback 使用，確認後將解除關聯。', { details: usage });
  }
  await tx`
    update feedback set revision = revision + 1, updated_at = now()
    where id in (select feedback_id from feedback_person_tags where person_tag_id = ${id})
  `;
  await tx`delete from person_tags where id = ${id}`;
  await syncPersonalPlacements(tx, productId);
  return { productRevision };
}

/** Replace a team member's person tags in this product. [] means 未安排. */
export async function setUserPersonTags(tx: Db, productId: string, userId: string, personTagIds: string[], expectedRevision: number) {
  const productRevision = await bumpProductRevision(tx, productId, expectedRevision);
  const [u] = await tx<{ role: string; membershipState: string }[]>`select role, membership_state from users where id = ${userId} for update`;
  if (!u) throw new AppError('NOT_FOUND');
  const ids = [...new Set(personTagIds)];
  if (ids.length > 0 && (u.role !== 'team' || u.membershipState !== 'active')) {
    throw invalid('只有有效的團隊成員可以持有 Person tag。', { personTagIds: '只能指派給團隊成員' });
  }
  if (ids.length > 0) {
    const found = await tx`select id from person_tags where product_id = ${productId} and id in ${tx(ids)}`;
    if (found.length !== ids.length) throw invalid('Person tag 不存在。', { personTagIds: '包含無效的 Person tag' });
  }
  await tx`delete from user_person_tags where user_id = ${userId} and product_id = ${productId}`;
  for (const id of ids) {
    await tx`insert into user_person_tags (user_id, product_id, person_tag_id) values (${userId}, ${productId}, ${id})`;
  }
  // later holders are not notified retroactively; Personal lists just follow
  await syncPersonalPlacements(tx, productId);
  return { personTagIds: ids, productRevision };
}
