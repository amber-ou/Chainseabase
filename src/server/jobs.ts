import { getSql, type Db } from './db';
import { fanoutNotificationEvent } from '@/modules/notifications/service';
import { sendInvitationJob } from '@/modules/identity/invitations';
import { logError } from './log';

interface JobRow { id: string; eventId: string | null; jobType: string; payload: Record<string, unknown>; attempts: number; maxAttempts: number }

const LEASE_SECONDS = 60;

export function backoffSeconds(attempts: number): number {
  const base = Math.min(3600, 10 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

async function runHandler(tx: Db, job: JobRow): Promise<'done' | 'retry' | 'failed'> {
  switch (job.jobType) {
    case 'notifications.fanout':
      if (job.eventId) await fanoutNotificationEvent(tx, job.eventId);
      return 'done';
    case 'invitation.send':
      return sendInvitationJob(tx, job.id, String(job.payload.invitationId));
    default:
      return 'failed';
  }
}

/**
 * Claim ready jobs with a lease (expired leases are reclaimed after a crash),
 * run each in its own transaction and record the outcome. Handlers are idempotent.
 */
export async function processJobs(opts: { ids?: string[]; limit?: number } = {}) {
  const sql = getSql();
  const limit = opts.limit ?? 20;
  const claimed = await sql<JobRow[]>`
    update outbox_jobs set state = 'processing', attempts = attempts + 1, lease_until = now() + ${`${LEASE_SECONDS} seconds`}::interval
    where id in (
      select id from outbox_jobs
      where ((state = 'pending' and next_attempt_at <= now()) or (state = 'processing' and lease_until < now()))
      ${opts.ids ? sql`and id in ${sql(opts.ids)}` : sql``}
      order by next_attempt_at
      limit ${limit}
      for update skip locked
    )
    returning id, event_id, job_type, payload, attempts, max_attempts
  `;
  const results: { id: string; outcome: string }[] = [];
  for (const job of claimed) {
    let outcome: 'done' | 'retry' | 'failed';
    try {
      outcome = await sql.begin((tx) => runHandler(tx as unknown as Db, job)) as 'done' | 'retry' | 'failed';
    } catch (e) {
      logError('job.failed', e, { jobId: job.id, jobType: job.jobType });
      outcome = 'retry';
    }
    if (outcome === 'retry' && job.attempts >= job.maxAttempts) outcome = 'failed';
    if (outcome === 'done') {
      await sql`update outbox_jobs set state = 'done', completed_at = now(), lease_until = null where id = ${job.id}`;
    } else if (outcome === 'failed') {
      await sql`update outbox_jobs set state = 'failed', lease_until = null, last_error = 'handler_failed' where id = ${job.id}`;
    } else {
      await sql`
        update outbox_jobs set state = 'pending', lease_until = null, last_error = 'retry',
          next_attempt_at = now() + ${`${backoffSeconds(job.attempts)} seconds`}::interval
        where id = ${job.id}
      `;
    }
    results.push({ id: job.id, outcome });
  }
  return results;
}

export async function outboxStats() {
  const sql = getSql();
  const rows = await sql<{ state: string; count: number }[]>`select state, count(*)::int as count from outbox_jobs group by state`;
  const [{ oldest }] = await sql<{ oldest: Date | null }[]>`select min(created_at) as oldest from outbox_jobs where state = 'pending'`;
  return { byState: Object.fromEntries(rows.map((r) => [r.state, r.count])), oldestPendingAt: oldest?.toISOString() ?? null };
}
