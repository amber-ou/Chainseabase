/**
 * Permanent product deletion (docs/change-requests/sidebar-position.md, phase 4).
 * Ownership is read from the database catalog, not a hand-written list: a row belongs to a product
 * when it carries that product_id, or references (through any foreign key) a row that does. A table
 * added later is checked automatically. Google is the in-memory fake (FakeCalendarApi): these MOCK
 * tests prove the platform never calls Google when deleting, not real Google behaviour.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSql, withTx } from '@/server/db';
import { CALENDAR_SCOPES } from '@/server/adapters/google-oauth';
import { deleteProduct } from '@/modules/products/service';
import { bootstrap } from '../../scripts/bootstrap-lib';
import { api, createFeedback, expectOk, installFakes, makeUser, resetDb, runJobs, seedWorld, type Fakes, type TestUser, type World } from '../helpers/harness';

let fakes: Fakes;
let w: World;
const CAL_A = 'product-a-calendar@group.calendar.google.com';
const CAL_B = 'product-b-calendar@group.calendar.google.com';

beforeAll(() => { fakes = installFakes(); });
beforeEach(async () => {
  await resetDb();
  fakes = installFakes();
  w = await seedWorld();
  fakes.calendar.addCalendar(CAL_A, '產品甲日曆', 'Asia/Taipei', { [w.teamA.sub]: 'writer', [w.teamB.sub]: 'writer' });
  fakes.calendar.addCalendar(CAL_B, '產品乙日曆', 'Asia/Taipei', { [w.teamA.sub]: 'writer', [w.teamB.sub]: 'writer' });
});

// ---------------- catalog: which rows belong to a product ----------------
interface Fk { child: string; parent: string; childCols: string[]; parentCols: string[] }
async function catalog() {
  const sql = getSql();
  const tables = (await sql<{ t: string }[]>`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'schema_migrations' order by 1`).map((r) => r.t);
  const withProductId = new Set((await sql<{ t: string }[]>`select table_name as t from information_schema.columns where table_schema = 'public' and column_name = 'product_id'`).map((r) => r.t));
  const fks = await sql<Fk[]>`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
      array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as child_cols,
      array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) as parent_cols
    from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace`;
  return { tables, withProductId, fks };
}
type Catalog = Awaited<ReturnType<typeof catalog>>;

/** SQL predicate (alias t) for "this row belongs to product $1"; accounts are never owned by a product. */
function owned(cat: Catalog, table: string, alias: string, seen: string[] = []): string | null {
  if (table === 'users') return null;
  if (table === 'products') return `${alias}.id = $1`;
  const parts: string[] = [];
  if (cat.withProductId.has(table)) parts.push(`${alias}.product_id = $1`);
  if (table === 'idempotency_records') parts.push(`split_part(${alias}.scope, ' ', 3) in ($1::text, $2::text)`);
  for (const fk of cat.fks.filter((f) => f.child === table && !seen.includes(f.parent) && f.parent !== table)) {
    const pa = `${alias}_${seen.length}${fk.parent.slice(0, 3)}`;
    const inner = owned(cat, fk.parent, pa, [...seen, table]);
    if (!inner) continue;
    const join = fk.childCols.map((c, i) => `${pa}.${fk.parentCols[i]} = ${alias}.${c}`).join(' and ');
    parts.push(`exists (select 1 from ${fk.parent} ${pa} where ${join} and (${inner}))`);
  }
  return parts.length ? parts.join(' or ') : null;
}

async function ownedCounts(cat: Catalog, product: { id: string; slug: string }) {
  const out: Record<string, number> = {};
  for (const t of cat.tables) {
    const pred = owned(cat, t, 't');
    if (!pred) continue;
    const [r] = await getSql().unsafe(`select count(*)::int as n from ${t} t where $2::text is not null and ($1::uuid is not null) and (${pred})`, [product.id, product.slug]);
    out[t] = r.n;
  }
  return out;
}
async function totals(tables: string[]) {
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = (await getSql().unsafe(`select count(*)::int as n from ${t}`))[0].n;
  return out;
}

// ---------------- data for a product, through the real API ----------------
let codeN = 0;
async function connectCalendar(u: TestUser) {
  const start = await api.get(`/integrations/google/calendar/start?returnTo=${encodeURIComponent('/products/x/calendar')}`, { as: u, origin: null });
  const transient = start.headers.getSetCookie().find((c) => c.startsWith('csb_oauth='))!.split(';')[0];
  const code = `del-code-${++codeN}`;
  fakes.oauth.codes.set(code, { claims: { sub: u.sub, email: u.email, emailVerified: true, name: u.name, picture: null }, scope: ['openid', 'email', ...CALENDAR_SCOPES], refreshToken: `refresh-${u.sub}-${codeN}` });
  const cb = await api.get(`/integrations/google/calendar/callback?code=${code}&state=${fakes.oauth.lastAuthorization!.state}`, { as: u, origin: null, headers: { cookie: transient } });
  expect(new URL(cb.headers.get('location')!, 'http://x').searchParams.get('calendar')).toBe('connected');
}

const timed = { summary: '刪除驗收', allDay: false, startDateTime: '2026-11-03T14:00:00+08:00', endDateTime: '2026-11-03T15:00:00+08:00', timeZone: 'Asia/Taipei' };

/** Feedback with tags, comments, likes, votes, schedule, Personal, notifications, calendar link, invitation. */
async function populate(productId: string, calendarId: string, extra: { personTagIds?: string[]; tagIds?: string[]; versionTagId?: string; tester?: TestUser } = {}) {
  const P = `/products/${productId}`;
  let personTagIds = extra.personTagIds;
  if (!personTagIds) {
    // a person tag of this product held by team B, so the card appears in team B's Personal view
    let tax = expectOk(await api.get(`${P}/taxonomy`, { as: w.teamA }));
    const pt = expectOk(await api.post(`${P}/person-tags`, { as: w.teamA, body: { name: '負責人', expectedRevision: tax.productRevision } })).personTag.id;
    tax = expectOk(await api.get(`${P}/taxonomy`, { as: w.teamA }));
    expectOk(await api.put(`${P}/users/${w.teamB.id}/person-tags`, { as: w.teamA, body: { personTagIds: [pt], expectedRevision: tax.productRevision } }));
    personTagIds = [pt];
  }
  const f = await createFeedback(w, { title: '要刪的回饋', visibility: 'public', personTagIds, tagIds: extra.tagIds ?? [], ...(extra.versionTagId ? { versionTagId: extra.versionTagId } : {}) }, w.teamA, productId);
  const c = expectOk(await api.post(`${P}/feedback/${f.id}/comments`, { as: w.teamA, body: { body: '團隊留言' } }), 201);
  expectOk(await api.put(`${P}/comments/${c.id}/like`, { as: w.teamB }));
  expectOk(await api.post(`${P}/feedback/${f.id}/comments`, { as: w.teamB, body: { body: '回覆', replyToId: c.id } }), 201);
  expectOk(await api.post(`${P}/feedback/${f.id}/schedule/comments`, { as: w.teamA, key: true, body: { body: '/2-3 內部工作', expectedRevision: 1 } }), 201);
  if (extra.tester) expectOk(await api.put(`/portal/products/${productId}/feedback/${f.id}/vote`, { site: 'portal', as: extra.tester }));
  // Personal: a view with a column and a placement, a private tag on the card
  const v = expectOk(await api.post(`${P}/personal/views`, { as: w.teamB, body: { subjectUserId: w.teamB.id } }));
  const col = expectOk(await api.post(`${P}/personal/views/${v.view.id}/columns`, { as: w.teamB, body: { name: '本週', expectedRevision: v.view.revision } }), 201);
  expectOk(await api.post(`${P}/personal/views/${v.view.id}/moves`, { as: w.teamB, body: { feedbackId: f.id, targetColumnId: col.column.id, expectedRevision: col.revision } }));
  const pt = expectOk(await api.post(`${P}/personal/tags`, { as: w.teamB, body: { name: '私人' } }), 201);
  expectOk(await api.put(`${P}/personal/feedback/${f.id}/tags`, { as: w.teamB, body: { personalTagIds: [pt.id], expectedRevision: 0 } }));
  // Roadmap: a move on the default board stores a rank for the card
  const [rm] = expectOk(await api.get(`${P}/roadmaps`, { as: w.teamA })) as { id: string }[];
  const board = expectOk(await api.get(`${P}/roadmaps/${rm.id}/board`, { as: w.teamA }));
  const card = board.columns.flatMap((c: any) => c.cards).find((x: any) => x.id === f.id);
  const target = board.columns.find((c: any) => !c.cards.some((x: any) => x.id === f.id));
  const fresh = expectOk(await api.get(`${P}/feedback/${f.id}`, { as: w.teamA }));
  expectOk(await api.post(`${P}/roadmaps/${rm.id}/moves`, { as: w.teamA, key: true, body: {
    feedbackId: f.id, targetColumnId: target.id, expectedFeedbackRevision: fresh.revision, expectedPlacementRevision: card.placementRevision,
  } }));
  // calendar: a binding, an event created from the platform and linked to the feedback
  expectOk(await api.put(`${P}/calendar/binding`, { as: w.teamA, body: { calendarId, expectedRevision: 0 } }));
  const ev = expectOk(await api.post(`${P}/calendar/events`, { as: w.teamA, key: true, body: { ...timed, feedbackId: f.id, bindingRevision: 1 } }), 201);
  await runJobs();
  return { feedbackId: f.id, commentId: c.id, eventId: ev.event.id as string, viewId: v.view.id as string };
}

async function revisionOf(productId: string) {
  return (expectOk(await api.get('/products', { as: w.teamA })) as { id: string; revision: number }[]).find((p) => p.id === productId)!.revision;
}
const del = (productId: string, confirmName: string, ifMatch: number | undefined, as: TestUser | null = w.teamA, site: 'admin' | 'portal' = 'admin') =>
  api.del(`/products/${productId}`, { as, site, ifMatch, body: { confirmName } });

describe('product deletion: scope', () => {
  it('removes every row of the product and nothing of the other product, accounts, credentials or Google', async () => {
    await connectCalendar(w.teamA);
    const a = await populate(w.productA.id, CAL_A, { personTagIds: [w.ptUiux], versionTagId: w.v10, tagIds: [w.perf], tester: w.tester });
    const b = await populate(w.productB.id, CAL_B);
    // an invitation for both products, and one for the deleted product only (both stay; only A's link goes)
    const both = expectOk(await api.post('/invitations', { as: w.teamA, key: true, body: { email: 'both@example.com', role: 'tester', productIds: [w.productA.id, w.productB.id] } }), 201);
    const onlyA = expectOk(await api.post('/invitations', { as: w.teamA, key: true, body: { email: 'onlya@example.com', role: 'tester', productIds: [w.productA.id] } }), 201);
    await runJobs();

    const cat = await catalog();
    const beforeA = await ownedCounts(cat, w.productA);
    const beforeB = await ownedCounts(cat, w.productB);
    // the data set really covers every table that can belong to a product
    const empty = Object.entries(beforeA).filter(([, n]) => n === 0).map(([t]) => t);
    expect(empty).toEqual([]);
    const shared = ['users', 'sessions', 'google_credentials', 'invitations', 'bootstrap_team_grants'];
    const sharedBefore = await totals(shared);
    const googleBefore = JSON.stringify([...fakes.calendar.calendars.entries()].map(([id, c]) => [id, [...c.events.entries()]]));
    const callsBefore = fakes.calendar.calls.length;
    const emailsBefore = fakes.email.sent.length;

    const r = await del(w.productA.id, '產品甲', await revisionOf(w.productA.id));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ id: w.productA.id, deleted: true });

    const afterA = await ownedCounts(cat, w.productA);
    expect(Object.entries(afterA).filter(([, n]) => n !== 0)).toEqual([]);
    expect(await ownedCounts(cat, w.productB)).toEqual(beforeB);
    expect(await totals(shared)).toEqual(sharedBefore);
    // Google: no call at all, calendars and events unchanged (the link to A's event is gone, the event is not)
    expect(fakes.calendar.calls.length).toBe(callsBefore);
    expect(JSON.stringify([...fakes.calendar.calendars.entries()].map(([id, c]) => [id, [...c.events.entries()]]))).toBe(googleBefore);
    expect(fakes.calendar.calendars.get(CAL_A)!.events.has(a.eventId)).toBe(true);
    // invitations stay; only the deleted product's link is removed
    const links = await getSql()<{ invitationId: string; productId: string }[]>`select invitation_id, product_id from invitation_products where invitation_id in (${both.id}, ${onlyA.id})`;
    expect(links).toEqual([{ invitationId: both.id, productId: w.productB.id }]);
    // nothing is queued or sent for the deleted product afterwards
    await runJobs();
    expect(fakes.email.sent.length).toBe(emailsBefore);

    // product B still works end to end
    expect(expectOk(await api.get(`/products/${w.productB.id}/feedback/${b.feedbackId}`, { as: w.teamA })).id).toBe(b.feedbackId);
    expect(expectOk(await api.get(`/products/${w.productB.id}/calendar/binding`, { as: w.teamA })).calendarId).toBe(CAL_B);
    // the personal Google authorization survives and still serves product B
    expect(expectOk(await api.get('/integrations/google/calendar/status', { as: w.teamA })).connected).toBe(true);
    expectOk(await api.get(`/products/${w.productB.id}/calendar/events?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z`, { as: w.teamA }));
    // the tester's account stays even with no product left
    expect((await getSql()`select 1 from users where id = ${w.tester.id}`).length).toBe(1);
    expect(a.viewId).toBeTruthy();
  });

  it('old URLs, the public site and direct API calls no longer read the deleted product', async () => {
    await connectCalendar(w.teamA);
    const a = await populate(w.productA.id, CAL_A, { tester: w.tester });
    expect((await del(w.productA.id, '產品甲', await revisionOf(w.productA.id))).status).toBe(200);
    const P = `/products/${w.productA.id}`;
    for (const path of [`${P}/taxonomy`, `${P}/feedback`, `${P}/feedback/${a.feedbackId}`, `${P}/feedback/${a.feedbackId}/comments`, `${P}/feedback/${a.feedbackId}/schedule`, `${P}/roadmaps`, `${P}/calendar/binding`, `${P}/calendar/events?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z`, `${P}/personal/tags`, `${P}/notifications`]) {
      expect((await api.get(path, { as: w.teamA })).status, path).toBe(404);
    }
    expect((await api.post(`${P}/personal/views`, { as: w.teamB, body: { subjectUserId: w.teamB.id } })).status).toBe(404);
    expect((await api.patch(P, { as: w.teamA, body: { name: '復活', expectedRevision: 1 } })).status).toBe(404);
    expect((await api.post(`${P}/feedback`, { as: w.teamA, key: true, body: { title: '新的' } })).status).toBe(404);
    for (const path of [`/public/products/${w.productA.slug}`, `/public/products/${w.productA.slug}/feedback`, `/public/products/${w.productA.slug}/roadmaps`, `/public/products/${w.productA.slug}/feedback/${a.feedbackId}`]) {
      expect((await api.get(path, { site: 'portal', as: w.tester })).status, path).toBe(404);
    }
    expect((await api.get(`/portal/products/${w.productA.id}/notifications`, { site: 'portal', as: w.tester })).status).toBe(404);
    const listed = expectOk(await api.get('/public/products', { site: 'portal', as: w.tester })) as { id: string }[];
    expect(listed.map((p) => p.id)).not.toContain(w.productA.id);
    expect((expectOk(await api.get('/products', { as: w.teamA })) as { id: string }[]).map((p) => p.id)).toEqual([w.productB.id]);
  });
});

describe('product deletion: confirmation and permissions', () => {
  it('needs the exact name: no trimming, case folding or partial match', async () => {
    const rev = await revisionOf(w.productA.id);
    for (const wrong of ['產品', '產品甲 ', ' 產品甲', '產品乙', '']) {
      const r = await del(w.productA.id, wrong, rev);
      expect(r.status, JSON.stringify(wrong)).toBe(400);
      expect(r.body.error.code).toBe('INVALID_REQUEST');
    }
    const renamed = expectOk(await api.post('/products', { as: w.teamA, body: { name: 'Alpha' } }));
    expect((await del(renamed.id, 'alpha', await revisionOf(renamed.id))).status).toBe(400);
    expect((await getSql()`select 1 from products where id in (${w.productA.id}, ${renamed.id})`).length).toBe(2);
  });

  it('rejects a stale revision (the product changed since the dialog opened) and a missing one', async () => {
    const rev = await revisionOf(w.productA.id);
    expectOk(await api.patch(`/products/${w.productA.id}`, { as: w.teamA, body: { name: '產品甲二', expectedRevision: rev } }));
    // the old name with the old revision: refused as a conflict
    const stale = await del(w.productA.id, '產品甲', rev);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');
    // the new name with the old revision is still refused: both must be current
    expect((await del(w.productA.id, '產品甲二', rev)).status).toBe(409);
    // no If-Match at all
    expect((await del(w.productA.id, '產品甲二', undefined)).status).toBe(428);
    expect((await getSql()`select 1 from products where id = ${w.productA.id}`).length).toBe(1);
    expect((await del(w.productA.id, '產品甲二', rev + 1)).status).toBe(200);
  });

  it('is refused to testers, people without a role, anonymous callers, the portal and other origins', async () => {
    const rev = await revisionOf(w.productA.id);
    expect((await del(w.productA.id, '產品甲', rev, w.tester)).status).toBe(403);
    expect((await del(w.productA.id, '產品甲', rev, w.outsider)).status).toBe(403);
    expect((await del(w.productA.id, '產品甲', rev, null)).status).toBe(401);
    expect((await del(w.productA.id, '產品甲', rev, w.teamA, 'portal')).status).toBe(404);
    const crossSite = await api.del(`/products/${w.productA.id}`, { as: w.teamA, ifMatch: rev, origin: 'http://evil.example', body: { confirmName: '產品甲' } });
    expect(crossSite.status).toBe(403);
    // unknown fields are rejected, not ignored
    expect((await api.del(`/products/${w.productA.id}`, { as: w.teamA, ifMatch: rev, body: { confirmName: '產品甲', cascade: false } })).status).toBe(400);
    expect((await getSql()`select 1 from products where id = ${w.productA.id}`).length).toBe(1);
    // any team member may delete
    expect((await del(w.productA.id, '產品甲', rev, w.teamB)).status).toBe(200);
  });

  it('a repeated request finds nothing to delete (404) and changes nothing else', async () => {
    const rev = await revisionOf(w.productA.id);
    expect((await del(w.productA.id, '產品甲', rev)).status).toBe(200);
    const again = await del(w.productA.id, '產品甲', rev);
    expect(again.status).toBe(404);
    expect((await getSql()`select 1 from products where id = ${w.productB.id}`).length).toBe(1);
    expect((await del('00000000-0000-4000-8000-000000000000', 'x', 1)).status).toBe(404);
  });
});

describe('product deletion: consistency', () => {
  it('rolls back completely when a step fails', async () => {
    await connectCalendar(w.teamA);
    await populate(w.productA.id, CAL_A, { tester: w.tester });
    const cat = await catalog();
    const before = await ownedCounts(cat, w.productA);
    const rev = await revisionOf(w.productA.id);
    // fail at the very last step (the product row) after every dependent row was deleted in the transaction
    await expect(withTx(async (tx) => {
      await deleteProduct(tx, w.productA.id, '產品甲', rev);
      throw new Error('simulated failure after the deletes');
    })).rejects.toThrow('simulated failure');
    expect(await ownedCounts(cat, w.productA)).toEqual(before);
    expect(await getSql()`select system_key from product_tombstones`).toEqual([]);
    expect((await del(w.productA.id, '產品甲', rev)).status).toBe(200);
  });

  it('a write racing the deletion either finishes first (then is deleted too) or fails with 404, leaving no orphan', async () => {
    const f = await createFeedback(w, { title: '並行' });
    const rev = await revisionOf(w.productA.id);
    const results = await Promise.all([
      del(w.productA.id, '產品甲', rev),
      api.post(`/products/${w.productA.id}/feedback`, { as: w.teamB, key: true, body: { title: '同時新增' } }),
      api.post(`/products/${w.productA.id}/feedback/${f.id}/comments`, { as: w.teamB, body: { body: '同時留言' } }),
      api.post(`/products/${w.productA.id}/tag-groups`, { as: w.teamB, body: { name: '同時群組', selectionMode: 'single', expectedRevision: rev } }),
    ]);
    // a settings change that commits first bumps the revision: the deletion is then refused (409), never forced
    expect([200, 409]).toContain(results[0].status);
    for (const r of results.slice(1)) expect([201, 404, 409]).toContain(r.status);
    if (results[0].status === 409) expect((await del(w.productA.id, '產品甲', await revisionOf(w.productA.id))).status).toBe(200);
    const cat = await catalog();
    expect(Object.entries(await ownedCounts(cat, w.productA)).filter(([, n]) => n !== 0)).toEqual([]);
  });

  it('two deletions of the same product at once: one succeeds, the other gets 404', async () => {
    const rev = await revisionOf(w.productA.id);
    const [x, y] = await Promise.all([del(w.productA.id, '產品甲', rev), del(w.productA.id, '產品甲', rev, w.teamB)]);
    expect([x.status, y.status].sort()).toEqual([200, 404]);
  });

  it('a queued job of the deleted product is not run afterwards', async () => {
    const f = await createFeedback(w, { title: '通知', personTagIds: [w.ptUiux] });
    // a comment whose notification fan-out is still queued when the product is deleted
    await getSql()`insert into domain_events (product_id, actor_id, type, payload) values (${w.productA.id}, ${w.teamA.id}, 'comment.created', ${getSql().json({ feedbackId: f.id, intents: [{ recipientId: w.teamB.id, reason: 'comment' }] } as never)})`;
    const queued = await getSql()`select j.id from outbox_jobs j join domain_events e on e.id = j.event_id where e.product_id = ${w.productA.id}`;
    expect((await del(w.productA.id, '產品甲', await revisionOf(w.productA.id))).status).toBe(200);
    if (queued.length) expect(await getSql()`select 1 from outbox_jobs where id in ${getSql()(queued.map((q) => q.id as string))}`).toEqual([]);
    await runJobs();
    expect(await getSql()`select 1 from notifications where feedback_id = ${f.id}`).toEqual([]);
  });
});

describe('product deletion: the last product and bootstrap', () => {
  it('deletes every product including the initial 產品1; bootstrap does not bring it back; a new product works', async () => {
    expect((await del(w.productB.id, '產品乙', await revisionOf(w.productB.id))).status).toBe(200);
    expect((await del(w.productA.id, '產品甲', await revisionOf(w.productA.id))).status).toBe(200);
    expect(expectOk(await api.get('/products', { as: w.teamA }))).toEqual([]);
    expect(expectOk(await api.get('/public/products', { site: 'portal', as: w.tester }))).toEqual([]);
    expect(await getSql()`select system_key from product_tombstones`).toEqual([{ systemKey: 'initial' }]);
    await bootstrap(getSql(), { teamEmail: null });
    await bootstrap(getSql(), { teamEmail: null });
    expect(await getSql()`select 1 from products`).toEqual([]);
    // the team can start again from zero
    const fresh = expectOk(await api.post('/products', { as: w.teamA, body: { name: '產品1' } }));
    expect(expectOk(await api.get(`/products/${fresh.id}/taxonomy`, { as: w.teamA })).statuses.length).toBeGreaterThan(0);
    // only the system key is remembered: the new product with the same name is an ordinary one
    expect((await getSql()`select system_key from products where id = ${fresh.id}`)[0].systemKey).toBeNull();
    const other = await makeUser('team', 'Late');
    expect(expectOk(await api.get('/products', { as: other })).map((p: { id: string }) => p.id)).toEqual([fresh.id]);
  });

  it('a first bootstrap on an empty database still creates 產品1', async () => {
    await resetDb();
    await bootstrap(getSql(), { teamEmail: null });
    expect((await getSql()`select name from products where system_key = 'initial'`)[0].name).toBe('產品1');
  });
});
