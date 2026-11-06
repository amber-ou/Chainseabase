import type { Ctx } from './http';
import type { Db } from './db';
import { AppError } from './errors';
import type { SessionUser } from './session';

export function requireUser(ctx: Ctx): SessionUser {
  if (!ctx.user) throw new AppError('AUTH_REQUIRED');
  return ctx.user;
}

export function requireTeam(ctx: Ctx): SessionUser {
  const user = requireUser(ctx);
  if (user.role !== 'team' || user.membershipState !== 'active') throw new AppError('ACTION_FORBIDDEN');
  return user;
}

/**
 * WIN-04: company content is for invited members only. A session alone is not enough: the account
 * must be an active team member or an active tester (removed members are loaded as role 'none').
 */
export function isMember(user: SessionUser): boolean {
  return user.membershipState === 'active' && (user.role === 'team' || user.role === 'tester');
}

/** For actions (uploads, portal writes): non-members get NOT_A_MEMBER. */
export function requireMember(ctx: Ctx): SessionUser {
  const user = requireUser(ctx);
  if (!isMember(user)) throw new AppError('NOT_A_MEMBER');
  return user;
}

/**
 * For reads of company content (data-permissions.md): 401 without a session, and 404 for a signed-in
 * account without access, the same answer as a resource that does not exist.
 */
export function requireReader(ctx: Ctx): SessionUser {
  const user = requireUser(ctx);
  if (!isMember(user)) throw new AppError('NOT_FOUND');
  return user;
}

export interface ProductRow { id: string; name: string; slug: string; revision: number; createdAt: Date }

/** Products the account may read: every product for team, invited products for testers, none otherwise. */
export async function listReadableProducts(db: Db, user: SessionUser): Promise<ProductRow[]> {
  if (!isMember(user)) return [];
  return db<ProductRow[]>`
    select p.id, p.name, p.slug, p.revision, p.created_at from products p
    where ${user.role === 'team'} or exists (select 1 from product_access a where a.user_id = ${user.id} and a.product_id = p.id)
    order by p.created_at, p.id
  `;
}

/**
 * Reader of one product's tester-visible projection (WIN-04): team, or a tester invited to it.
 * Membership is checked before the product is looked up; uninvited or removed accounts and testers
 * of other products all get the same 404 as an unknown slug, so callers cannot probe which exist.
 */
export async function requireProductReader(ctx: Ctx, db: Db, slug: string): Promise<{ user: SessionUser; product: ProductRow; isTeam: boolean }> {
  const user = requireReader(ctx);
  const rows = await db<ProductRow[]>`
    select p.id, p.name, p.slug, p.revision, p.created_at from products p
    where p.slug = ${slug}
      and (${user.role === 'team'} or exists (select 1 from product_access a where a.user_id = ${user.id} and a.product_id = p.id))
  `;
  if (!rows[0]) throw new AppError('NOT_FOUND');
  return { user, product: rows[0], isTeam: user.role === 'team' };
}

/** Team scope: the product must exist. Unknown IDs answer 404. */
export async function requireProduct(db: Db, productId: string): Promise<ProductRow> {
  const rows = await db<ProductRow[]>`select id, name, slug, revision, created_at from products where id = ${productId}`;
  if (!rows[0]) throw new AppError('NOT_FOUND');
  return rows[0];
}

export async function hasProductInteraction(db: Db, user: SessionUser | null, productId: string): Promise<boolean> {
  if (!user || user.membershipState !== 'active') return false;
  if (user.role === 'team') return true;
  if (user.role !== 'tester') return false;
  const rows = await db`select 1 from product_access where user_id = ${user.id} and product_id = ${productId}`;
  return rows.length > 0;
}

/** Portal interactions: team members, or testers invited to this product. */
export async function requirePortalMember(ctx: Ctx, db: Db, productId: string): Promise<SessionUser> {
  const user = requireUser(ctx);
  if (!(await hasProductInteraction(db, user, productId))) throw new AppError('NOT_A_MEMBER');
  return user;
}
