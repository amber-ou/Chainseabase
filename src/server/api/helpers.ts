import { withTx, type Tx } from '../db';
import type { Ctx } from '../http';
import { idempotent } from '../idempotency';
import { requireUser } from '../authz';

/** Run a mutation in one transaction, deduplicated by Idempotency-Key when present. */
export async function mutate<T>(
  ctx: Ctx, opts: { keyRequired?: boolean; body?: unknown },
  fn: (tx: Tx) => Promise<{ status?: number; data: T }>,
) {
  const user = requireUser(ctx);
  const key = ctx.idempotencyKey(Boolean(opts.keyRequired));
  const productScope = ctx.params.p ?? ctx.params.slug ?? '-';
  const scope = `${ctx.method} ${ctx.routePattern} ${productScope} ${Object.entries(ctx.params).map(([k, v]) => `${k}=${v}`).join(',')}`;
  const body = opts.body === undefined ? await ctx.rawBody().catch(() => null) : opts.body;
  const r = await withTx((tx) => idempotent(tx, { actorId: user.id, scope, key, body }, () => fn(tx)));
  return { status: r.status, data: r.data, meta: r.replayed ? { idempotentReplay: true } : {} };
}

export async function read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTx(fn);
}
