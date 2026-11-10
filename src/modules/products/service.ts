import type { Db } from '@/server/db';
import { AppError, assertRevision } from '@/server/errors';
import { slugify } from '@/modules/shared/text';
import { detachDeletedProduct } from '@/modules/identity/invitations';
import { deleteImagesOfProduct } from '@/modules/feedback/images';
import { deleteViewsOfProduct } from '@/modules/feedback/views';

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

/**
 * Permanently delete a product and every platform row that belongs only to it, in one transaction.
 * The product row is locked first: writers that insert rows referencing it wait on that lock and then
 * fail their foreign key check (404), so nothing new can attach to a product being deleted.
 * Kept: users, sessions, personal Google credentials, accepted invitations and invitations that still
 * have another product (only this product's link is removed), other products. A pending tester
 * invitation left with no product is revoked, not deleted. Google calendars, events and sharing are
 * never touched; only the platform's binding and links go. A product bootstrap provisions by system_key leaves a tombstone.
 */
export async function deleteProduct(tx: Db, productId: string, confirmName: string, expectedRevision: number): Promise<{ id: string; deleted: true }> {
  const [p] = await tx<{ name: string; slug: string; revision: number; systemKey: string | null }[]>`
    select name, slug, revision, system_key from products where id = ${productId} for update
  `;
  if (!p) throw new AppError('NOT_FOUND');
  assertRevision(p.revision, expectedRevision);
  // exact match only: no trimming, case folding or partial match; the name is a confirmation, not an identifier
  if (confirmName !== p.name) throw new AppError('INVALID_REQUEST', '輸入的名稱與產品名稱不一致。', { fieldErrors: { confirmName: '名稱不一致' } });

  // events, their jobs and notifications: nothing may be sent or shown for the product afterwards
  await tx`delete from notifications where product_id = ${productId}`;
  await tx`delete from outbox_jobs where event_id in (select id from domain_events where product_id = ${productId})`;
  await tx`delete from domain_events where product_id = ${productId}`;
  // calendar: platform binding and links only (Google is not called)
  await tx`delete from calendar_event_links where product_id = ${productId}`;
  await tx`delete from calendar_mutations where product_id = ${productId}`;
  await tx`delete from calendar_bindings where product_id = ${productId}`;
  // Personal (private views, placements, private tags and notes of every owner, for this product)
  await tx`delete from personal_feedback_tags where product_id = ${productId}`;
  await tx`delete from personal_feedback_metadata where product_id = ${productId}`;
  await tx`delete from personal_views where product_id = ${productId}`;
  await tx`delete from personal_tags where product_id = ${productId}`;
  // Roadmap boards (columns and ranks cascade)
  await tx`delete from roadmaps where product_id = ${productId}`;
  // images (rows now, their files by a job after commit), comments, votes, then the feedback itself
  // (feedback tags cascade)
  await deleteImagesOfProduct(tx, productId);
  // shared Feedback views and their row orders (2026-11-10, migration 0008)
  await deleteViewsOfProduct(tx, productId);
  await tx`delete from comment_likes where comment_id in (select id from comments where product_id = ${productId})`;
  await tx`delete from feedback_votes where feedback_id in (select id from feedback where product_id = ${productId})`;
  await tx`delete from comments where product_id = ${productId}`;
  await tx`delete from feedback where product_id = ${productId}`;
  // taxonomy: person tags (and who holds them here), tags, groups, categories, statuses
  await tx`delete from person_tags where product_id = ${productId}`;
  await tx`delete from tags where product_id = ${productId}`;
  await tx`delete from tag_groups where product_id = ${productId}`;
  await tx`delete from categories where product_id = ${productId}`;
  await tx`delete from statuses where product_id = ${productId}`;
  // access: this product's grants and invitation links (accounts and invitations stay)
  await tx`delete from product_access where product_id = ${productId}`;
  // invitations: this product's links go; a pending tester invitation left with no product is revoked
  // and its queued e-mails cancelled (team and accepted invitations, and accounts, are not touched)
  await detachDeletedProduct(tx, productId);
  // stored responses of idempotent requests made in this product (scope: method, route, product id or slug, …)
  await tx`delete from idempotency_records where split_part(scope, ' ', 3) in (${productId}, ${p.slug})`;
  if (p.systemKey) await tx`insert into product_tombstones (system_key) values (${p.systemKey}) on conflict do nothing`;
  await tx`delete from products where id = ${productId}`;
  return { id: productId, deleted: true };
}
