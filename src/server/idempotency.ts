import type { Db } from './db';
import { AppError } from './errors';
import { bodyHash } from './crypto';

export interface IdemResult<T> { status: number; data: T; replayed: boolean }

const RETENTION_HOURS = 24;

/**
 * Runs `fn` at most once per (actor, scope, key) inside the caller's transaction.
 * Same key + same body returns the stored response; same key + different body is 409.
 * The record commits atomically with the mutation, so a failed attempt leaves no record
 * and a retry executes again (exactly-once success).
 */
export async function idempotent<T>(
  tx: Db,
  opts: { actorId: string; scope: string; key: string | null; body: unknown },
  fn: () => Promise<{ status?: number; data: T }>,
): Promise<IdemResult<T>> {
  if (!opts.key) {
    const r = await fn();
    return { status: r.status ?? 200, data: r.data, replayed: false };
  }
  const hash = bodyHash(opts.body);
  await tx`delete from idempotency_records where actor_id = ${opts.actorId} and scope = ${opts.scope} and key = ${opts.key} and expires_at < now()`;
  const inserted = await tx`
    insert into idempotency_records (actor_id, scope, key, body_hash, expires_at)
    values (${opts.actorId}, ${opts.scope}, ${opts.key}, ${hash}, now() + ${`${RETENTION_HOURS} hours`}::interval)
    on conflict do nothing
    returning key
  `;
  if (inserted.length === 0) {
    const [existing] = await tx<{ bodyHash: string; responseStatus: number | null; responseBody: T }[]>`
      select body_hash, response_status, response_body from idempotency_records
      where actor_id = ${opts.actorId} and scope = ${opts.scope} and key = ${opts.key}
    `;
    if (!existing) throw new AppError('REVISION_CONFLICT', '同時有相同操作進行中，請稍後再試。', { retryable: true });
    if (existing.bodyHash !== hash) throw new AppError('IDEMPOTENCY_CONFLICT');
    if (existing.responseStatus === null) throw new AppError('REVISION_CONFLICT', '相同操作仍在處理中。', { retryable: true });
    return { status: existing.responseStatus, data: existing.responseBody, replayed: true };
  }
  const r = await fn();
  const status = r.status ?? 200;
  await tx`
    update idempotency_records set response_status = ${status}, response_body = ${tx.json(r.data as never)}
    where actor_id = ${opts.actorId} and scope = ${opts.scope} and key = ${opts.key}
  `;
  return { status, data: r.data, replayed: false };
}
