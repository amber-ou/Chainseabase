import type { Db } from './db';
import { collectJob } from './jobs-context';

export type NotificationReason = 'assigned' | 'comment' | 'schedule_comment';

export interface NotificationIntent { recipientId: string; reason: NotificationReason }

/**
 * Persist a domain event and its outbox jobs in the caller's transaction.
 * Notification intents from one transaction share one event so a recipient
 * gets at most one merged notification per event.
 */
export async function emitEvent(
  tx: Db,
  e: { productId: string | null; actorId: string | null; type: string; payload: Record<string, unknown>; jobTypes?: string[] },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into domain_events (product_id, actor_id, type, payload)
    values (${e.productId}, ${e.actorId}, ${e.type}, ${tx.json(e.payload as never)})
    returning id
  `;
  for (const jobType of e.jobTypes ?? []) {
    const [job] = await tx<{ id: string }[]>`
      insert into outbox_jobs (event_id, job_type, payload) values (${row.id}, ${jobType}, '{}'::jsonb) returning id
    `;
    collectJob(job.id);
  }
  return row.id;
}

export async function emitNotificationEvent(
  tx: Db,
  e: { productId: string; actorId: string; feedbackId: string; type: string; intents: NotificationIntent[]; extra?: Record<string, unknown> },
): Promise<string | null> {
  const intents = e.intents.filter((i) => i.recipientId !== e.actorId);
  if (intents.length === 0) return null;
  return emitEvent(tx, {
    productId: e.productId,
    actorId: e.actorId,
    type: e.type,
    payload: { feedbackId: e.feedbackId, intents, ...(e.extra ?? {}) },
    jobTypes: ['notifications.fanout'],
  });
}

export async function enqueueJob(tx: Db, jobType: string, payload: Record<string, unknown>): Promise<string> {
  const [job] = await tx<{ id: string }[]>`
    insert into outbox_jobs (job_type, payload) values (${jobType}, ${tx.json(payload as never)}) returning id
  `;
  collectJob(job.id);
  return job.id;
}
