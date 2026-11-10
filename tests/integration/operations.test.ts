import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, getSql, setSql } from '@/server/db';
import { getConfig } from '@/server/config';
import { logError, logInfo } from '@/server/log';
import { api, createFeedback, expectOk, installFakes, resetDb, runJobs, seedWorld, type World } from '../helpers/harness';

let w: World;
beforeAll(() => { installFakes(); });
beforeEach(async () => {
  await resetDb();
  w = await seedWorld();
});

describe('operations', () => {
  it('O02 a worker that died mid-job (expired lease) is resumed; notifications are not duplicated', async () => {
    await getSql()`select 1`;
    const f = await createFeedback(w, { title: '工作中斷' }, w.teamB);
    // simulate: comment committed, inline processing never happened, a worker claimed and crashed
    await getSql().begin(async (tx) => {
      const [ev] = await tx`insert into domain_events (product_id, actor_id, type, payload) values (${w.productA.id}, ${w.teamA.id}, 'comment.created', ${tx.json({ feedbackId: f.id, intents: [{ recipientId: w.teamB.id, reason: 'comment' }] } as never)}) returning id`;
      await tx`insert into outbox_jobs (event_id, job_type, state, attempts, lease_until) values (${ev.id}, 'notifications.fanout', 'processing', 1, now() - interval '5 minutes')`;
    });
    const r = await runJobs();
    expect(r.map((x) => x.outcome)).toEqual(['done']);
    await getSql()`update outbox_jobs set state = 'processing', lease_until = now() - interval '1 minute'`;
    await runJobs();
    const [{ c }] = await getSql()`select count(*)::int as c from notifications where recipient_id = ${w.teamB.id}`;
    expect(c).toBe(1);
    const stats = await api.get('/jobs/run', { headers: { authorization: 'Bearer test-job-secret' } });
    expect(stats.status).toBe(200);
    expect(stats.body.data.stats.byState.done).toBeGreaterThan(0);
    expect((await api.get('/jobs/run', { headers: { authorization: 'Bearer wrong' } })).status).toBe(404);
  });

  it('failed jobs back off and stop after max attempts instead of retrying forever', async () => {
    await getSql()`insert into outbox_jobs (job_type, payload, max_attempts) values ('unknown.type', '{}', 2)`;
    await runJobs();
    const [job] = await getSql()`select state, attempts from outbox_jobs where job_type = 'unknown.type'`;
    expect(job.state).toBe('failed');
  });

  it('O04 logs scrub sensitive keys and API errors never echo secrets or SQL', async () => {
    const lines: string[] = [];
    const orig = { log: console.log, error: console.error };
    console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
    console.error = (...a: unknown[]) => { lines.push(a.join(' ')); };
    process.env.LOG_TESTS = '1';
    try {
      logInfo('x', { refreshToken: 'SECRET-1', inviteToken: 'SECRET-2', email: 'a@example.com', requestId: 'r1' });
      logError('y', new Error('boom'), { authorization: 'Bearer SECRET-3', body: 'private text' });
    } finally {
      console.log = orig.log;
      console.error = orig.error;
      delete process.env.LOG_TESTS;
    }
    const out = lines.join('\n');
    for (const s of ['SECRET-1', 'SECRET-2', 'SECRET-3', 'a@example.com', 'private text']) expect(out).not.toContain(s);
    expect(out).toContain('r1');
    const r = await api.get(`/products/${w.productA.id}/feedback?statusId=not-a-uuid`, { as: w.teamA });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/select|from feedback|postgres/i);
  });

  it('health endpoint answers on both hosts', async () => {
    // provider modes are reported (tests run on fakes in development), never credentials
    const expected = { ok: true, environment: 'development', providers: { calendar: 'fake', email: 'fake', storage: 'fake' }, storageBackend: 'fake' };
    expect(expectOk(await api.get('/health'))).toEqual(expected);
    expect(expectOk(await api.get('/health', { site: 'portal' }))).toEqual(expected);
  });

  it('WIN-03 health answers 503 (not a generic 500) while the database is unreachable, then recovers', async () => {
    const real = getSql();
    const url = getConfig().databaseUrl;
    const down = createSql('postgres://nobody@127.0.0.1:9/nothing', 1);
    setSql(down, url);
    try {
      const r = await api.get('/health');
      expect(r.status).toBe(503);
      expect(r.body.data).toMatchObject({ ok: false, database: 'unavailable', environment: 'development' });
      expect(JSON.stringify(r.body)).not.toContain('127.0.0.1:9');
    } finally {
      setSql(real, url);
      await down.end({ timeout: 1 });
    }
    expect(expectOk(await api.get('/health')).ok).toBe(true);
  });
});
