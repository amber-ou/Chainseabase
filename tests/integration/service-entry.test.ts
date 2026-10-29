import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * WIN-03: the Windows service runs `node scripts/service/start-website.mjs` directly (no npm.cmd).
 * Here it runs as a real child process with a configuration file, in --wait-only mode so no build
 * is needed: the database wait, its exit codes and its log lines are the same as under the service.
 */
const repo = path.resolve(__dirname, '../..');
const entry = path.join(repo, 'scripts', 'service', 'start-website.mjs');
const testDb = process.env.TEST_DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_test';

function run(databaseUrl: string, args: string[], extra: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-service-'));
  const file = path.join(dir, 'chainseabase.env');
  const lines = [`DATABASE_URL=${databaseUrl}`, ...extra];
  // a URL without a password (as on the Windows host) takes it from PGPASSWORD
  if (process.env.PGPASSWORD && !/:\/\/[^/@]*:[^/@]*@/.test(databaseUrl)) lines.push(`PGPASSWORD=${process.env.PGPASSWORD}`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  // only what Node needs to run: no application variables leak in from this test process
  const env: Record<string, string> = { CHAINSEABASE_CONFIG_FILE: file };
  for (const k of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'HOME']) { const v = process.env[k]; if (v) env[k] = v; }
  const r = spawnSync(process.execPath, [entry, '--wait-only', ...args], { cwd: dir, env: env as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 60_000 });
  fs.rmSync(dir, { recursive: true, force: true });
  const json = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { status: r.status, json, out: r.stdout + r.stderr };
}

describe('WIN-03 service entry point', () => {
  it('waits for the database, then reports it ready (exit 0 in --wait-only mode)', () => {
    const r = run(testDb, ['--db-wait-seconds=10']);
    expect(r.status, r.out).toBe(0);
    expect(r.json.map((l) => l.event)).toEqual(['website.starting', 'db.ready']);
  });

  it('keeps retrying while nothing answers, then exits 75 for the service manager to restart it', () => {
    const closed = 'postgresql://chainseabase@127.0.0.1:9/chainseabase';
    const started = Date.now();
    const r = run(closed, ['--db-wait-seconds=4'], ['PGPASSWORD=not-a-real-secret-value']);
    expect(r.status, r.out).toBe(75);
    expect(Date.now() - started).toBeLessThan(20_000);
    const events = r.json.map((l) => l.event);
    expect(events[0]).toBe('website.starting');
    expect(events.filter((e) => e === 'db.wait').length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toBe('db.unavailable');
    expect(r.json.find((l) => l.event === 'db.wait').errorCode).toBe('ECONNREFUSED');
    // names and error classes only: no connection string or password in the log
    expect(r.out).not.toContain('not-a-real-secret-value');
    expect(r.out).not.toContain('127.0.0.1:9');
  });

  it('stops at once with 78 when the password is wrong (waiting cannot fix it)', () => {
    const u = new URL(testDb);
    u.password = 'definitely-wrong-password';
    const r = run(u.toString(), ['--db-wait-seconds=30'], []);
    expect(r.status, r.out).toBe(78);
    expect(r.json.at(-1)).toMatchObject({ event: 'db.unavailable', reason: 'fatal' });
    expect(r.out).not.toContain('definitely-wrong-password');
  });

  it('refuses bad arguments and a refused configuration before touching the database', () => {
    expect(run(testDb, ['--port=99999']).status).toBe(64);
    expect(run(testDb, [], ['NOT_A_KNOWN_KEY=1']).status).toBe(78);
  });
});
