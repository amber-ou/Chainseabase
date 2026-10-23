import type { Db } from '@/server/db';
import { AppError, assertRevision } from '@/server/errors';
import { slugify } from '@/modules/shared/text';

export const DEFAULT_STATUSES = ['新貼文', '進行中', '待討論', '已完成', '延後'] as const;
export const DEFAULT_ROADMAP_LABELS = ['需求池', '進行中', '待討論', '已完成', '延後'] as const;
export const DEFAULT_CATEGORY = '需求討論';
export const VERSION_GROUP_NAME = '版本';

export interface ProductDto { id: string; name: string; slug: string; revision: number; createdAt: string }

export function productDto(p: { id: string; name: string; slug: string; revision: number; createdAt: Date }): ProductDto {
  return { id: p.id, name: p.name, slug: p.slug, revision: p.revision, createdAt: p.createdAt.toISOString() };
}

export async function listProducts(db: Db): Promise<ProductDto[]> {
  const rows = await db<{ id: string; name: string; slug: string; revision: number; createdAt: Date }[]>`
    select id, name, slug, revision, created_at from products order by created_at, id
  `;
  return rows.map(productDto);
}

async function uniqueSlug(tx: Db, name: string): Promise<string> {
  const base = slugify(name);
  if (base.length >= 3) {
    const taken = await tx`select 1 from products where slug = ${base}`;
    if (taken.length === 0) return base;
    for (let i = 2; i < 1000; i++) {
      const s = `${base.slice(0, 45)}-${i}`;
      if ((await tx`select 1 from products where slug = ${s}`).length === 0) return s;
    }
  }
  const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from products`;
  for (let i = count + 1; i < count + 1000; i++) {
    const s = `product-${i}`;
    if ((await tx`select 1 from products where slug = ${s}`).length === 0) return s;
  }
  throw new AppError('INTERNAL');
}

/** Insert the per-product defaults (same transaction as product creation). */
export async function initProductDefaults(tx: Db, productId: string) {
  const statusIds: string[] = [];
  for (let i = 0; i < DEFAULT_STATUSES.length; i++) {
    const [s] = await tx<{ id: string }[]>`
      insert into statuses (product_id, name, position, is_default)
      values (${productId}, ${DEFAULT_STATUSES[i]}, ${i}, ${i === 0}) returning id
    `;
    statusIds.push(s.id);
  }
  await tx`insert into categories (product_id, name, position, is_default) values (${productId}, ${DEFAULT_CATEGORY}, 0, true)`;
  await tx`
    insert into tag_groups (product_id, name, selection_mode, system_key, position)
    values (${productId}, ${VERSION_GROUP_NAME}, 'single', 'version', 0)
  `;
  const [rm] = await tx<{ id: string }[]>`
    insert into roadmaps (product_id, name, description, dimension, is_default, position)
    values (${productId}, '產品進度', '依狀態分欄的預設看板', 'status', true, 0) returning id
  `;
  for (let i = 0; i < statusIds.length; i++) {
    await tx`
      insert into roadmap_columns (roadmap_id, product_id, label, position, status_id)
      values (${rm.id}, ${productId}, ${DEFAULT_ROADMAP_LABELS[i]}, ${i}, ${statusIds[i]})
    `;
  }
}

export async function createProduct(tx: Db, input: { name: string; systemKey?: string }): Promise<ProductDto> {
  const slug = await uniqueSlug(tx, input.name);
  const [p] = await tx<{ id: string; name: string; slug: string; revision: number; createdAt: Date }[]>`
    insert into products (name, slug, system_key) values (${input.name}, ${slug}, ${input.systemKey ?? null})
    returning id, name, slug, revision, created_at
  `;
  await initProductDefaults(tx, p.id);
  return productDto(p);
}

export async function renameProduct(tx: Db, productId: string, name: string, expectedRevision: number): Promise<ProductDto> {
  const [p] = await tx<{ revision: number }[]>`select revision from products where id = ${productId} for update`;
  if (!p) throw new AppError('NOT_FOUND');
  assertRevision(p.revision, expectedRevision);
  // slug intentionally stays stable when the name changes
  const [row] = await tx<{ id: string; name: string; slug: string; revision: number; createdAt: Date }[]>`
    update products set name = ${name}, revision = revision + 1 where id = ${productId}
    returning id, name, slug, revision, created_at
  `;
  return productDto(row);
}

/** Lock the product row and verify/bump its revision (settings mutations). */
export async function bumpProductRevision(tx: Db, productId: string, expectedRevision: number | undefined): Promise<number> {
  const [p] = await tx<{ revision: number }[]>`select revision from products where id = ${productId} for update`;
  if (!p) throw new AppError('NOT_FOUND');
  assertRevision(p.revision, expectedRevision);
  const [r] = await tx<{ revision: number }[]>`update products set revision = revision + 1 where id = ${productId} returning revision`;
  return r.revision;
}
