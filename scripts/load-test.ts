/**
 * O05 representative load against a running server. Two scenarios (LOAD_SCENARIO=normal|contention|both):
 *
 * - normal: N team members (default 30) mixing list, board, schedule command, roadmap move and
 *   notification reads with think time between actions (LOAD_THINK_MS, default 2000-6000);
 * - contention: the same members do nothing but drag cards on one board with no think time; most
 *   drops land in the same column, and a share of them (LOAD_SHARED_RATIO) targets a few hot cards
 *   several people move at once (real same-card conflicts).
 *
 * Retry policy mirrors the UI: a 409 order_changed (neighbours moved) reloads the board and drops
 * the card once more at the same intended position; a 409 card_changed (the card itself changed)
 * is never retried. After each scenario the board invariants are checked in the database.
 *
 * Users/sessions are created directly in LOAD_DATABASE_URL (name must contain e2e, load or
 * staging, or the server must confirm it is staging; see assertSafeTarget) — never production.
 */
import { randomUUID } from 'node:crypto';
import { createSql, setSql } from '../src/server/db';
import { createSession } from '../src/server/session';

const BASE = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3100';
const DB = process.env.LOAD_DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_e2e';
const USERS = Number(process.env.LOAD_USERS ?? 30);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 30);
const SCENARIO = process.env.LOAD_SCENARIO ?? 'both';
const [THINK_MIN, THINK_MAX] = (process.env.LOAD_THINK_MS ?? '2000-6000').split('-').map(Number);
const SHARED_RATIO = Number(process.env.LOAD_SHARED_RATIO ?? 0.2);
const HOT_CARDS = 3;
// Supabase names its database "postgres": a staging target is accepted only with an explicit
// LOAD_ENV_CONFIRM=staging and when the server itself reports environment "staging" on /health.
async function assertSafeTarget() {
  if (/(e2e|load|staging)/.test(new URL(DB).pathname)) return;
  const health = process.env.LOAD_ENV_CONFIRM === 'staging'
    ? await fetch(`${BASE}/api/v1/health`).then((r) => r.json()).catch(() => null)
    : null;
  if (health?.data?.environment !== 'staging') {
    console.error('Refusing: LOAD_DATABASE_URL must be an e2e/load/staging database, or set LOAD_ENV_CONFIRM=staging against a server whose /health reports environment "staging".');
    process.exit(1);
  }
}

const sql = createSql(DB, 4);
setSql(sql, DB);

interface Sample { ms: number; status: number; reason: string | null }
type Card = { id: string; revision: number; placementRevision: number };
type Column = { id: string; label: string; count: number; cards: Card[]; nextCursor: string | null };

let samples = new Map<string, Sample[]>();
function record(op: string, s: Sample) {
  if (!samples.has(op)) samples.set(op, []);
  samples.get(op)!.push(s);
}
async function call(op: string, cookie: string, method: string, path: string, body?: unknown, key?: string) {
  const t = performance.now();
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { cookie, origin: BASE, ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  record(op, { ms: performance.now() - t, status: res.status, reason: json?.error?.details?.reason ?? null });
  return { status: res.status, json };
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Full board: every column's complete order (follows column pages past the first 100). */
async function fullBoard(op: string, cookie: string, P: string, roadmapId: string): Promise<Column[] | null> {
  const res = await call(op, cookie, 'GET', `${P}/roadmaps/${roadmapId}/board?limit=100`);
  if (res.status !== 200) return null;
  const columns: Column[] = res.json.data.columns;
  for (const c of columns) {
    let cursor = c.nextCursor;
    while (cursor) {
      const page = await call(`${op}.page`, cookie, 'GET', `${P}/roadmaps/${roadmapId}/columns/${c.id}/feedback?limit=100&cursor=${encodeURIComponent(cursor)}`);
      if (page.status !== 200) return null;
      c.cards.push(...page.json.data);
      cursor = page.json.meta.nextCursor;
    }
  }
  return columns;
}
const findCard = (cols: Column[], id: string) => cols.flatMap((c) => c.cards).find((c) => c.id === id) ?? null;

interface MoveOutcome { final: 'ok' | 'ok_after_retry' | 'order_changed' | 'card_changed' | 'other' }
const successes = new Map<string, number>();

/**
 * Drop `cardId` into `columnId` at `slot` (0 = top; clamped to the column length) from the given
 * board snapshot; on order_changed reload and drop once more at the same slot.
 */
async function dragCard(op: string, cookie: string, P: string, roadmapId: string, board: Column[], cardId: string, columnId: string, slot: number): Promise<MoveOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const card = findCard(board, cardId);
    const col = board.find((c) => c.id === columnId);
    if (!card || !col) return { final: 'other' };
    const others = col.cards.filter((c) => c.id !== cardId);
    const index = Math.min(slot, others.length);
    const res = await call(attempt ? `${op}.retry` : op, cookie, 'POST', `${P}/roadmaps/${roadmapId}/moves`, {
      feedbackId: cardId, targetColumnId: columnId,
      afterFeedbackId: others[index - 1]?.id ?? null, beforeFeedbackId: others[index]?.id ?? null,
      expectedFeedbackRevision: card.revision, expectedPlacementRevision: card.placementRevision,
    }, randomUUID());
    if (res.status === 200) {
      successes.set(cardId, (successes.get(cardId) ?? 0) + 1);
      return { final: attempt ? 'ok_after_retry' : 'ok' };
    }
    const reason = res.json?.error?.details?.reason;
    if (res.status !== 409) return { final: 'other' };
    // the card itself changed: never retried blindly, the user sees the reloaded board
    if (reason === 'card_changed') return { final: 'card_changed' };
    if (attempt === 1) return { final: 'order_changed' };
    const fresh = await fullBoard(`${op}.reload`, cookie, P, roadmapId);
    if (!fresh) return { final: 'other' };
    board = fresh;
  }
  return { final: 'other' };
}

async function makeUsers(run: string) {
  const cookies: string[] = [];
  for (let i = 0; i < USERS; i++) {
    const [u] = await sql<{ id: string }[]>`insert into users (google_sub, verified_email, display_name, role) values (${`load-${run}-${i}`}, ${`load${i}-${run}@load.test`}, ${`負載 ${i}`}, 'team') returning id`;
    cookies.push(`csb_session=${await createSession(sql, u.id, 'admin')}`);
  }
  return cookies;
}

async function placementSnapshot(roadmapId: string) {
  const rows = await sql<{ feedbackId: string; placementRevision: number }[]>`select feedback_id, placement_revision from roadmap_ranks where roadmap_id = ${roadmapId}`;
  return new Map(rows.map((r) => [r.feedbackId, r.placementRevision]));
}

/** Board invariants after a run: one column per card, correct classification, no rank ties, versions consistent. */
async function checkInvariants(productId: string, roadmapId: string, cookie: string, P: string, before: Map<string, number>, createdTitles: string[]) {
  const [{ live }] = await sql<{ live: number }[]>`select count(*)::int as live from feedback where product_id = ${productId} and deleted_at is null`;
  const [{ ranked }] = await sql<{ ranked: number }[]>`select count(*)::int as ranked from roadmap_ranks rr join feedback f on f.id = rr.feedback_id where rr.roadmap_id = ${roadmapId} and f.deleted_at is null`;
  const [{ misclassified }] = await sql<{ misclassified: number }[]>`
    select count(*)::int as misclassified from roadmap_ranks rr
    join roadmap_columns rc on rc.id = rr.column_id join feedback f on f.id = rr.feedback_id
    where rr.roadmap_id = ${roadmapId} and rc.status_id is distinct from f.status_id`;
  const [{ ties }] = await sql<{ ties: number }[]>`select count(*)::int as ties from (select column_id, rank from roadmap_ranks where roadmap_id = ${roadmapId} group by column_id, rank having count(*) > 1) x`;
  const [{ dupTitles }] = await sql<{ dupTitles: number }[]>`select count(*)::int as dup_titles from (select title from feedback where title in ${sql(createdTitles)} group by title having count(*) > 1) x`;
  const board = await fullBoard('check', cookie, P, roadmapId);
  const ids = board!.flatMap((c) => c.cards.map((x) => x.id));
  const counted = board!.reduce((n, c) => n + c.count, 0);
  const after = await placementSnapshot(roadmapId);
  let placementMismatch = 0;
  for (const [id, n] of successes) if ((after.get(id) ?? 0) - (before.get(id) ?? 0) !== n) placementMismatch++;
  return {
    liveFeedback: live, rankRows: ranked, boardCount: counted, boardCards: ids.length, duplicateCardsOnBoard: ids.length - new Set(ids).size,
    misclassified, rankTies: ties, duplicateCreates: dupTitles, placementRevisionMismatches: placementMismatch,
    ok: live === ranked && live === counted && ids.length === live && new Set(ids).size === live && misclassified === 0 && ties === 0 && dupTitles === 0 && placementMismatch === 0,
  };
}

function report(name: string, outcomes: Map<string, MoveOutcome['final'][]>) {
  const rows = [...samples.entries()].filter(([op]) => op !== 'setup' && !op.startsWith('check')).map(([op, xs]) => {
    const ok = xs.filter((s) => s.status >= 200 && s.status < 300);
    const c409 = xs.filter((s) => s.status === 409);
    return {
      op, count: xs.length,
      successRate: `${((ok.length / xs.length) * 100).toFixed(1)}%`,
      conflict409: `${((c409.length / xs.length) * 100).toFixed(1)}%`,
      orderChanged: c409.filter((s) => s.reason === 'order_changed').length,
      cardChanged: c409.filter((s) => s.reason === 'card_changed').length,
      other: xs.length - ok.length - c409.length,
      okP50: Math.round(pct(ok.map((s) => s.ms), 50)), okP95: Math.round(pct(ok.map((s) => s.ms), 95)), okMax: Math.round(Math.max(0, ...ok.map((s) => s.ms))),
    };
  });
  const finals = [...outcomes.entries()].map(([kind, xs]) => {
    const n = (k: MoveOutcome['final']) => xs.filter((x) => x === k).length;
    return {
      kind, intents: xs.length, ok: n('ok'), okAfterRetry: n('ok_after_retry'),
      finalSuccessRate: `${(((n('ok') + n('ok_after_retry')) / Math.max(1, xs.length)) * 100).toFixed(1)}%`,
      orderChangedAfterRetry: n('order_changed'), cardChangedNoRetry: n('card_changed'), other: n('other'),
    };
  });
  console.log(`\n== ${name}: requests (latency = successful requests only, ms)`);
  console.table(rows);
  console.log(`== ${name}: move outcomes per drag intent (after at most one re-drop on order_changed)`);
  console.table(finals);
  return { rows, finals };
}

async function runScenario(name: 'normal' | 'contention') {
  samples = new Map();
  successes.clear();
  const [product] = await sql<{ id: string }[]>`select id from products order by created_at limit 1`;
  const P = `/products/${product.id}`;
  const run = randomUUID().slice(0, 6);
  const cookies = await makeUsers(run);
  const roadmaps = (await call('setup', cookies[0], 'GET', `${P}/roadmaps`)).json.data;
  const def = roadmaps.find((r: { isDefault: boolean }) => r.isDefault);
  const titles: string[] = [];
  const own: string[] = [];
  for (let i = 0; i < USERS; i++) {
    const title = `負載 ${name} ${run}-${i}`;
    titles.push(title);
    own.push((await call('setup', cookies[i], 'POST', `${P}/feedback`, { title }, randomUUID())).json.data.id);
  }
  const hot: string[] = [];
  if (name === 'contention') {
    for (let i = 0; i < HOT_CARDS; i++) {
      const title = `負載 共用 ${run}-${i}`;
      titles.push(title);
      hot.push((await call('setup', cookies[0], 'POST', `${P}/feedback`, { title }, randomUUID())).json.data.id);
    }
  }
  const before = await placementSnapshot(def.id);
  const outcomes = new Map<string, MoveOutcome['final'][]>();
  const note = (kind: string, o: MoveOutcome) => { if (!outcomes.has(kind)) outcomes.set(kind, []); outcomes.get(kind)!.push(o.final); };
  const deadline = Date.now() + SECONDS * 1000;
  const started = Date.now();

  await Promise.all(cookies.map(async (cookie, i) => {
    if (name === 'normal') await sleep(Math.random() * THINK_MAX); // members do not start in lockstep
    while (Date.now() < deadline) {
      if (name === 'normal') {
        await call('feedback.list', cookie, 'GET', `${P}/feedback?limit=50`);
        const sched = (await call('schedule.get', cookie, 'GET', `${P}/feedback/${own[i]}/schedule`)).json?.data;
        if (sched) await call('schedule.command', cookie, 'POST', `${P}/feedback/${own[i]}/schedule/comments`, { body: `/2-${1 + (i % 5)} 負載 ${Date.now()}`, expectedRevision: sched.revision }, randomUUID());
        const board = await fullBoard('roadmap.board', cookie, P, def.id);
        if (board) {
          const target = pick(board);
          note('own card', await dragCard('roadmap.move', cookie, P, def.id, board, own[i], target.id, Math.floor(Math.random() * (target.cards.length + 1))));
        }
        await call('notifications.list', cookie, 'GET', `${P}/notifications?limit=30`);
        await sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
      } else {
        const board = await fullBoard('roadmap.board', cookie, P, def.id);
        if (!board) continue;
        // most drops into the first column (one hot column), the rest anywhere
        const target = Math.random() < 0.7 ? board[0] : pick(board);
        const slot = Math.floor(Math.random() * Math.min(6, target.cards.length + 1)); // near the top, where everyone drops
        if (Math.random() < SHARED_RATIO) note('shared hot card', await dragCard('roadmap.move.shared', cookie, P, def.id, board, pick(hot), target.id, slot));
        else note('own card', await dragCard('roadmap.move.own', cookie, P, def.id, board, own[i], target.id, slot));
      }
    }
  }));
  const elapsed = (Date.now() - started) / 1000;
  const result = report(name, outcomes);
  const invariants = await checkInvariants(product.id, def.id, cookies[0], P, before, titles);
  console.log(`== ${name}: invariants`, invariants);
  return { scenario: name, users: USERS, seconds: SECONDS, elapsed, ...(name === 'normal' ? { thinkMs: [THINK_MIN, THINK_MAX] } : { sharedRatio: SHARED_RATIO, hotCards: HOT_CARDS }), ...result, invariants };
}

async function main() {
  await assertSafeTarget();
  const scenarios = SCENARIO === 'both' ? (['normal', 'contention'] as const) : [SCENARIO as 'normal' | 'contention'];
  const results = [];
  for (const s of scenarios) results.push(await runScenario(s));
  console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), results }));
  if (results.some((r) => !r.invariants.ok)) process.exitCode = 2;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => sql.end());
