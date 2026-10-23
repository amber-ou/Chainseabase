/**
 * O05 representative load: N concurrent team members (default 30) for D seconds against a
 * running server, mixing list, board, schedule command, roadmap move and notification reads.
 * Users/sessions are created directly in LOAD_DATABASE_URL (name must contain e2e, load or
 * staging) — never run against production. Reports p50/p95/max per operation.
 */
import { randomUUID } from 'node:crypto';
import { createSql, setSql } from '../src/server/db';
import { createSession } from '../src/server/session';

const BASE = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3100';
const DB = process.env.LOAD_DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_e2e';
const USERS = Number(process.env.LOAD_USERS ?? 30);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 30);
if (!/(e2e|load|staging)/.test(new URL(DB).pathname)) {
  console.error('Refusing: LOAD_DATABASE_URL must be an e2e/load/staging database.');
  process.exit(1);
}

const sql = createSql(DB, 4);
setSql(sql, DB);
const samples = new Map<string, number[]>();
const statuses = new Map<string, Map<number, number>>();
function record(op: string, ms: number, status: number) {
  if (!samples.has(op)) { samples.set(op, []); statuses.set(op, new Map()); }
  samples.get(op)!.push(ms);
  const m = statuses.get(op)!;
  m.set(status, (m.get(status) ?? 0) + 1);
}
async function call(op: string, cookie: string, method: string, path: string, body?: unknown, key?: string) {
  const t = performance.now();
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { cookie, origin: BASE, ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  record(op, performance.now() - t, res.status);
  return { status: res.status, json };
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };

async function main() {
  const [product] = await sql<{ id: string }[]>`select id from products order by created_at limit 1`;
  const run = randomUUID().slice(0, 6);
  const cookies: string[] = [];
  for (let i = 0; i < USERS; i++) {
    const [u] = await sql<{ id: string }[]>`insert into users (google_sub, verified_email, display_name, role) values (${`load-${run}-${i}`}, ${`load${i}-${run}@load.test`}, ${`負載 ${i}`}, 'team') returning id`;
    cookies.push(`csb_session=${await createSession(sql, u.id, 'admin')}`);
  }
  const P = `/products/${product.id}`;
  const roadmaps = (await call('setup', cookies[0], 'GET', `${P}/roadmaps`)).json.data;
  const def = roadmaps.find((r: { isDefault: boolean }) => r.isDefault);
  const deadline = Date.now() + SECONDS * 1000;
  await Promise.all(cookies.map(async (cookie, i) => {
    const fb = (await call('feedback.create', cookie, 'POST', `${P}/feedback`, { title: `負載測試 ${run}-${i}` }, randomUUID())).json.data;
    while (Date.now() < deadline) {
      await call('feedback.list', cookie, 'GET', `${P}/feedback?limit=50`);
      const board = (await call('roadmap.board', cookie, 'GET', `${P}/roadmaps/${def.id}/board?limit=50`)).json?.data;
      const sched = (await call('schedule.get', cookie, 'GET', `${P}/feedback/${fb.id}/schedule`)).json?.data;
      if (sched) await call('schedule.command', cookie, 'POST', `${P}/feedback/${fb.id}/schedule/comments`, { body: `/2-${1 + (i % 5)} 負載 ${Date.now()}`, expectedRevision: sched.revision }, randomUUID());
      if (board) {
        const cols = board.columns;
        const target = cols[Math.floor(Math.random() * cols.length)];
        const cur = (await call('feedback.get', cookie, 'GET', `${P}/feedback/${fb.id}`)).json?.data;
        if (cur) await call('roadmap.move', cookie, 'POST', `${P}/roadmaps/${def.id}/moves`, {
          feedbackId: fb.id, targetColumnId: target.id, beforeFeedbackId: null, afterFeedbackId: null,
          expectedFeedbackRevision: cur.revision, expectedRoadmapRevision: board.roadmap.revision,
        }, randomUUID());
      }
      await call('notifications.list', cookie, 'GET', `${P}/notifications?limit=30`);
    }
  }));
  const rows = [...samples.entries()].filter(([op]) => op !== 'setup').map(([op, xs]) => ({
    op, count: xs.length, p50: Math.round(pct(xs, 50)), p95: Math.round(pct(xs, 95)), max: Math.round(Math.max(...xs)),
    statuses: Object.fromEntries(statuses.get(op)!),
  }));
  console.table(rows);
  console.log(JSON.stringify({ users: USERS, seconds: SECONDS, base: BASE, at: new Date().toISOString(), rows }));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => sql.end());
