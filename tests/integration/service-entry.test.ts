import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
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
  // (unless the case supplies its own)
  if (process.env.PGPASSWORD && !/:\/\/[^/@]*:[^/@]*@/.test(databaseUrl) && !extra.some((l) => l.startsWith('PGPASSWORD='))) lines.push(`PGPASSWORD=${process.env.PGPASSWORD}`);
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

  it('with --exit-with-parent it exits by itself when the service wrapper dies (no orphan holding the port)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-orphan-'));
    const file = path.join(dir, 'chainseabase.env');
    // a database that never answers keeps the entry point busy waiting
    fs.writeFileSync(file, 'DATABASE_URL=postgresql://chainseabase@127.0.0.1:9/chainseabase\nPGPASSWORD=x\n', { mode: 0o600 });
    const out = path.join(dir, 'child.log');
    const events = path.join(dir, 'events.log');
    // the "wrapper": starts the entry point, reports its pid, then is killed. detached: on Windows a
    // Node parent otherwise puts its children in a kill-on-close job, unlike WinSW (.NET), whose
    // children outlive it (that is how the orphan appeared in the service test)
    const wrapper = `const fs=require('fs');const c=require('child_process').spawn(process.execPath,[${JSON.stringify(entry)},'--exit-with-parent','--db-wait-seconds=120',${JSON.stringify(`--event-log=${events}`)}],{cwd:${JSON.stringify(dir)},detached:true,env:{...process.env,CHAINSEABASE_CONFIG_FILE:${JSON.stringify(file)}},stdio:['ignore',fs.openSync(${JSON.stringify(out)},'a'),'ignore']});console.log(c.pid);setInterval(()=>{},1000);`;
    const env: Record<string, string> = {};
    for (const k of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'HOME']) { const v = process.env[k]; if (v) env[k] = v; }
    const parent = spawn(process.execPath, ['-e', wrapper], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'ignore'] });
    const childPid = await new Promise<number>((resolve) => parent.stdout!.once('data', (d) => resolve(Number(String(d).trim()))));
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    await new Promise((r) => setTimeout(r, 1500));
    expect(alive(childPid)).toBe(true);
    parent.kill('SIGKILL');
    const deadline = Date.now() + 15_000;
    while (alive(childPid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    expect(alive(childPid)).toBe(false);
    const lines = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).event);
    expect(lines.at(-1)).toBe('service.wrapper_exited');
    // also in the event file, which does not depend on the wrapper's stdout pipe
    expect(JSON.parse(fs.readFileSync(events, 'utf8').trim())).toMatchObject({ event: 'service.wrapper_exited', pid: childPid, parentPid: parent.pid });
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it('refuses bad arguments and a refused configuration before touching the database', () => {
    expect(run(testDb, ['--port=99999']).status).toBe(64);
    expect(run(testDb, [], ['NOT_A_KNOWN_KEY=1']).status).toBe(78);
  });
});
