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

export interface ProductRow { id: string; name: string; slug: string; revision: number; createdAt: Date }

/** Team scope: the product must exist. Unknown IDs answer 404. */
export async function requireProduct(db: Db, productId: string): Promise<ProductRow> {
  const rows = await db<ProductRow[]>`select id, name, slug, revision, created_at from products where id = ${productId}`;
  if (!rows[0]) throw new AppError('NOT_FOUND');
  return rows[0];
}

export async function productBySlug(db: Db, slug: string): Promise<ProductRow> {
  const rows = await db<ProductRow[]>`select id, name, slug, revision, created_at from products where slug = ${slug}`;
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
