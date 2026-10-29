import { describe, expect, it } from 'vitest';
import { isRetryable, waitForDatabase } from '../../scripts/service/wait-for-database.mjs';

function clock() {
  let t = 0;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, sleeps };
}
const err = (code: string) => Object.assign(new Error('x'), { code });

describe('WIN-03 database wait at service start', () => {
  it('retries "not ready" errors with capped backoff until the database answers', async () => {
    const c = clock();
    const lines: any[] = [];
    let calls = 0;
    const r = await waitForDatabase({
      probe: async () => { calls++; if (calls <= 6) throw err(calls % 2 ? 'ECONNREFUSED' : '57P03'); },
      maxWaitMs: 600_000, log: (l) => lines.push(l), sleep: c.sleep, now: c.now,
    });
    expect(r).toEqual({ ok: true, attempts: 7 });
    expect(c.sleeps).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    expect(lines.filter((l) => l.event === 'db.wait').map((l) => l.errorCode)).toEqual(['ECONNREFUSED', '57P03', 'ECONNREFUSED', '57P03', 'ECONNREFUSED', '57P03']);
    expect(lines.at(-1)).toMatchObject({ event: 'db.ready', attempt: 7, waitedMs: 45000 });
  });

  it('gives up after the configured wait so the service manager can restart it', async () => {
    const c = clock();
    const lines: any[] = [];
    const r = await waitForDatabase({ probe: async () => { throw err('ECONNREFUSED'); }, maxWaitMs: 20_000, log: (l) => lines.push(l), sleep: c.sleep, now: c.now });
    expect(r).toMatchObject({ ok: false, reason: 'timeout', code: 'ECONNREFUSED' });
    expect(c.now()).toBeLessThanOrEqual(20_000);
    expect(lines.at(-1)).toMatchObject({ event: 'db.unavailable', reason: 'timeout' });
  });

  it('stops at once on errors that waiting cannot fix (wrong password, missing database)', async () => {
    for (const code of ['28P01', '3D000', '28000']) {
      const c = clock();
      const r = await waitForDatabase({ probe: async () => { throw err(code); }, maxWaitMs: 600_000, log: () => {}, sleep: c.sleep, now: c.now });
      expect(r).toEqual({ ok: false, attempts: 1, reason: 'fatal', code });
      expect(c.sleeps).toEqual([]);
    }
    expect(isRetryable(new Error('no code'))).toBe(false);
  });
});
