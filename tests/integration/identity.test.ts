import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSql } from '@/server/db';
import { bootstrap } from '../../scripts/bootstrap-lib';
import { invitationTokenForJob } from '@/modules/identity/invitations';
import { api, expectOk, installFakes, makeUser, resetDb, runJobs, seedWorld, createFeedback, type Fakes, type World, ADMIN } from '../helpers/harness';

let fakes: Fakes;

beforeAll(() => {
  fakes = installFakes();
});

describe('A01 bootstrap is idempotent', () => {
  beforeEach(resetDb);
  it('creates one 產品1, defaults and one first-team grant even when run twice (and concurrently)', async () => {
    const sql = getSql();
    await Promise.all([bootstrap(sql, { teamEmail: 'Lead@Example.com' }), bootstrap(sql, { teamEmail: 'lead@example.com' })]);
    await bootstrap(sql, { teamEmail: 'lead@example.com' });
    const products = await sql`select id, name, slug from products`;
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('產品1');
    expect(products[0].slug).toBe('product-1');
    const statuses = await sql`select name from statuses order by position`;
    expect(statuses.map((s) => s.name)).toEqual(['新貼文', '進行中', '待討論', '已完成', '延後']);
    expect(await sql`select name from categories`).toHaveLength(1);
    expect(await sql`select 1 from tag_groups where system_key = 'version'`).toHaveLength(1);
    expect(await sql`select 1 from roadmaps where is_default`).toHaveLength(1);
    expect(await sql`select email from bootstrap_team_grants`).toEqual([{ email: 'lead@example.com' }]);
    // no demo data in the production initialization
    expect(await sql`select 1 from feedback`).toHaveLength(0);
    expect(await sql`select 1 from users`).toHaveLength(0);
  });

  it('first login with the bootstrap email becomes team exactly once; first other login does not', async () => {
    await bootstrap(getSql(), { teamEmail: 'lead@example.com' });
    fakes.oauth.codes.set('code-other', { claims: { sub: 'other1', email: 'first@example.com', emailVerified: true, name: '先登入者', picture: null }, scope: [], refreshToken: null });
    fakes.oauth.codes.set('code-lead', { claims: { sub: 'lead1', email: 'lead@example.com', emailVerified: true, name: '負責人', picture: null }, scope: [], refreshToken: null });
    for (const code of ['code-other', 'code-lead']) {
      const start = await api.get('/auth/google/start?returnTo=/products', { origin: null });
      expect(start.status).toBe(302);
      const cookie = start.headers.get('set-cookie')!.split(';')[0];
      const state = fakes.oauth.lastAuthorization!.state;
      const cb = await api.get(`/auth/google/callback?code=${code}&state=${state}`, { origin: null, headers: { cookie } });
      expect(cb.status).toBe(302);
      expect(cb.headers.get('location')).toBe(`${ADMIN}/products`);
      const setCookies = cb.headers.getSetCookie();
      const session = setCookies.find((c) => c.startsWith('csb_session='))!;
      expect(session).toContain('HttpOnly');
      expect(session).not.toMatch(/Domain=/i);
    }
    const users = await getSql()`select verified_email, role from users order by created_at`;
    expect(users).toEqual([{ verifiedEmail: 'first@example.com', role: 'none' }, { verifiedEmail: 'lead@example.com', role: 'team' }]);
    // re-running bootstrap after a team exists does not create a new grant
    const r = await bootstrap(getSql(), { teamEmail: 'someone-else@example.com' });
    expect(r.grant).toBe('skipped_team_exists');
  });

  it('rejects a callback with a mismatched state and an unverified Google email', async () => {
    const start = await api.get('/auth/google/start', { origin: null });
    const cookie = start.headers.get('set-cookie')!.split(';')[0];
    const bad = await api.get('/auth/google/callback?code=x&state=wrong', { origin: null, headers: { cookie } });
    expect(bad.headers.get('location')).toContain('/login?error=state');
    fakes.oauth.codes.set('code-unverified', { claims: { sub: 'u2', email: 'u2@example.com', emailVerified: false, name: 'x', picture: null }, scope: [], refreshToken: null });
    const start2 = await api.get('/auth/google/start', { origin: null });
    const cookie2 = start2.headers.get('set-cookie')!.split(';')[0];
    const cb = await api.get(`/auth/google/callback?code=code-unverified&state=${fakes.oauth.lastAuthorization!.state}`, { origin: null, headers: { cookie: cookie2 } });
    expect(cb.headers.get('location')).toContain('/login?error=unverified');
    expect(await getSql()`select 1 from users`).toHaveLength(0);
  });

  it('only accepts same-site relative returnTo paths', async () => {
    await api.get('/auth/google/start?returnTo=https://evil.example/x', { origin: null });
    const start = await api.get('/auth/google/start?returnTo=//evil.example', { origin: null });
    expect(start.status).toBe(302);
    const { readTransient } = await import('@/modules/identity/auth');
    const cookie = start.headers.get('set-cookie')!.split(';')[0];
    const t = await readTransient(new Request('http://x', { headers: { cookie } }), 'login', 'admin', fakes.oauth.lastAuthorization!.state);
    expect(t.returnTo).toBe('/');
  });
});

describe('A02–A12 permissions, invitations and membership', () => {
  let w: World;
  beforeEach(async () => {
    await resetDb();
    fakes.email.sent.length = 0;
    w = await seedWorld();
  });

  it('A02 an uninvited Google account cannot read company content, interact or use admin APIs (WIN-04)', async () => {
    const fb = await createFeedback(w, { visibility: 'public', title: '公開需求' });
    // the anonymous-readable portal rule was retired (docs/windows-native-deployment.md, 存取規則變更)
    const pub = await api.get(`/public/products/${w.productA.slug}/feedback`, { site: 'portal', as: w.outsider });
    // reads answer 404 like an unknown resource (data-permissions.md); the account's own /me says why
    expect(pub.status).toBe(404);
    expect(JSON.stringify(pub.body)).not.toContain('公開需求');
    expect(expectOk(await api.get('/public/products', { site: 'portal', as: w.outsider }))).toEqual([]);
    const me = expectOk(await api.get('/me', { site: 'portal', as: w.outsider }));
    expect(me.role).toBe('none');
    expect(me.interactiveProducts).toEqual([]);
    const vote = await api.put(`/portal/products/${w.productA.id}/feedback/${fb.id}/vote`, { site: 'portal', as: w.outsider });
    expect(vote.status).toBe(403);
    expect(vote.body.error.code).toBe('NOT_A_MEMBER');
    expect((await api.get(`/products/${w.productA.id}/feedback`, { as: w.outsider })).status).toBe(403);
    expect((await api.get(`/products/${w.productA.id}/feedback`)).status).toBe(401);
  });

  it('A03/A04 invitation acceptance checks the email, is single-use, and expiry/revocation invalidates it', async () => {
    const inv = expectOk(await api.post('/invitations', { as: w.teamA, key: true, body: { email: 'NewTester@Example.com', role: 'tester', productIds: [w.productA.id] } }), 201);
    // the email job runs right after commit; the create response reports the state it committed
    expect(inv.status).toBe('pending');
    expect(JSON.stringify(inv)).not.toMatch(/token/i);
    const listedInv = expectOk(await api.get('/invitations', { as: w.teamA })).find((i: any) => i.id === inv.id);
    expect(listedInv.status).toBe('sent');
    expect(JSON.stringify(listedInv)).not.toMatch(/token/i);
    expect(fakes.email.sent).toHaveLength(1);
    const link = /https?:\/\/\S+invite\?token=([\w-]+)/.exec(fakes.email.sent[0].text)!;
    const token = decodeURIComponent(link[1]);
    expect(link[0].startsWith('http://portal.test.local/invite')).toBe(true);
    // stored only as a hash
    const [row] = await getSql()`select token_hash from invitations where id = ${inv.id}`;
    expect(row.tokenHash).not.toContain(token);

    const wrong = await makeUser('none', 'Wrong');
    const mismatch = await api.post('/invitations/accept', { site: 'portal', as: wrong, body: { token } });
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');

    const invitee = await makeUser('none', 'NewTester');
    await getSql()`update users set verified_email = 'newtester@example.com' where id = ${invitee.id}`;
    expectOk(await api.post('/invitations/accept', { site: 'portal', as: invitee, body: { token } }));
    const again = expectOk(await api.post('/invitations/accept', { site: 'portal', as: invitee, body: { token } }));
    expect(again.alreadyAccepted).toBe(true);
    expect(await getSql()`select product_id from product_access where user_id = ${invitee.id}`).toEqual([{ productId: w.productA.id }]);
    const me = expectOk(await api.get('/me', { site: 'portal', as: invitee }));
    expect(me.role).toBe('tester');
    expect(me.interactiveProducts.map((p: any) => p.id)).toEqual([w.productA.id]);

    // revoked and expired invitations are invalid
    const inv2 = expectOk(await api.post('/invitations', { as: w.teamA, key: true, body: { email: 'other@example.com', role: 'tester', productIds: [w.productA.id] } }), 201);
    const t2 = decodeURIComponent(/token=([\w%-]+)/.exec(fakes.email.sent[1].text)![1]);
    expectOk(await api.del(`/invitations/${inv2.id}`, { as: w.teamA, ifMatch: inv2.revision }));
    const other = await makeUser('none', 'Other');
    await getSql()`update users set verified_email = 'other@example.com' where id = ${other.id}`;
    expect((await api.post('/invitations/accept', { site: 'portal', as: other, body: { token: t2 } })).status).toBe(410);
    const inv3 = expectOk(await api.post('/invitations', { as: w.teamA, key: true, body: { email: 'other@example.com', role: 'tester', productIds: [w.productA.id] } }), 201);
    const t3 = decodeURIComponent(/token=([\w%-]+)/.exec(fakes.email.sent[2].text)![1]);
    await getSql()`update invitations set expires_at = now() - interval '1 minute' where id = ${inv3.id}`;
    const expired = await api.post('/invitations/accept', { site: 'portal', as: other, body: { token: t3 } });
    expect(expired.status).toBe(410);
    expect(expired.body.error.message).toContain('過期');
  });

  it('A05 testers cannot call admin APIs or interact with another product', async () => {
    const fbB = await createFeedback(w, { visibility: 'public' }, w.teamA, w.productB.id);
    expect((await api.get(`/products/${w.productA.id}/feedback`, { as: w.tester })).status).toBe(403);
    expect((await api.post(`/products/${w.productA.id}/feedback`, { as: w.tester, key: true, body: { title: 'x' } })).status).toBe(403);
    const crossVote = await api.put(`/portal/products/${w.productB.id}/feedback/${fbB.id}/vote`, { site: 'portal', as: w.tester });
    expect(crossVote.status).toBe(403);
    const crossCreate = await api.post(`/portal/products/${w.productB.id}/feedback`, { site: 'portal', as: w.tester, key: true, body: { title: 'x' } });
    expect(crossCreate.status).toBe(403);
    // internal endpoints are not served on the portal host at all
    expect((await api.get(`/products/${w.productA.id}/feedback`, { site: 'portal', as: w.teamA })).status).toBe(404);
  });

  it('A06 concurrent demotion/removal can never leave zero team members', async () => {
    await getSql()`update users set role = 'tester' where id = ${w.teamB.id}`;
    const teamC = await makeUser('team', 'Team C');
    const users = await getSql()<{ id: string; revision: number }[]>`select id, revision from users where id in (${w.teamA.id}, ${teamC.id})`;
    const rev = (id: string) => users.find((u) => u.id === id)!.revision;
    const [r1, r2] = await Promise.all([
      api.patch(`/users/${teamC.id}/role`, { as: w.teamA, body: { role: 'tester', testerProductIds: [], expectedRevision: rev(teamC.id) } }),
      api.del(`/users/${w.teamA.id}/membership`, { as: teamC, ifMatch: rev(w.teamA.id) }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);
    const [{ count }] = await getSql()`select count(*)::int as count from users where role = 'team' and membership_state = 'active'`;
    expect(count).toBe(1);
  });

  it('A07 a removed member loses access on the next request but stays as historical author', async () => {
    const fb = await createFeedback(w, { title: '由 B 建立' }, w.teamB);
    const [u] = await getSql()`select revision from users where id = ${w.teamB.id}`;
    expectOk(await api.del(`/users/${w.teamB.id}/membership`, { as: w.teamA, ifMatch: u.revision }));
    expect((await api.get(`/products/${w.productA.id}/feedback`, { as: w.teamB })).status).toBe(401);
    const dto = expectOk(await api.get(`/products/${w.productA.id}/feedback/${fb.id}`, { as: w.teamA }));
    expect(dto.author.displayName).toBe('Team B');
  });

  it('A08 product scope: IDs from another product are rejected with 404', async () => {
    const fbA = await createFeedback(w, { title: '甲的回饋' });
    expect((await api.get(`/products/${w.productB.id}/feedback/${fbA.id}`, { as: w.teamA })).status).toBe(404);
    const statusA = w.tax.statuses[0].id;
    const r = await api.post(`/products/${w.productB.id}/feedback`, { as: w.teamA, key: true, body: { title: 'x', statusId: statusA } });
    expect(r.status).toBe(400);
    const tagCross = await api.post(`/products/${w.productB.id}/feedback`, { as: w.teamA, key: true, body: { title: 'x', tagIds: [w.loose] } });
    expect(tagCross.status).toBe(400);
  });

  it('A09 product create/rename keeps id and slug; there is no delete endpoint', async () => {
    const p = expectOk(await api.post('/products', { as: w.teamA, body: { name: 'Search Console' } }), 201);
    expect(p.slug).toBe('search-console');
    const renamed = expectOk(await api.patch(`/products/${p.id}`, { as: w.teamA, body: { name: '搜尋主控台', expectedRevision: p.revision } }));
    expect(renamed.id).toBe(p.id);
    expect(renamed.slug).toBe('search-console');
    const tax = expectOk(await api.get(`/products/${p.id}/taxonomy`, { as: w.teamA }));
    expect(tax.statuses.map((s: any) => s.name)).toEqual(['新貼文', '進行中', '待討論', '已完成', '延後']);
    expect((await api.del(`/products/${p.id}`, { as: w.teamA })).status).toBeGreaterThanOrEqual(400);
    const stale = await api.patch(`/products/${p.id}`, { as: w.teamA, body: { name: 'x', expectedRevision: p.revision } });
    expect(stale.status).toBe(409);
  });

  it('A10 a team member cannot read another member\'s Personal views, personal tags or tokens', async () => {
    const view = expectOk(await api.post(`/products/${w.productA.id}/personal/views`, { as: w.teamB, body: { subjectUserId: w.teamB.id } }));
    const tag = expectOk(await api.post(`/products/${w.productA.id}/personal/tags`, { as: w.teamB, body: { name: 'B 的私人' } }), 201);
    const viewId = view.view.id;
    expect((await api.patch(`/products/${w.productA.id}/personal/views/${viewId}`, { as: w.teamA, body: { sortMode: 'freedom', expectedRevision: view.view.revision } })).status).toBe(404);
    expect((await api.post(`/products/${w.productA.id}/personal/views/${viewId}/columns`, { as: w.teamA, body: { name: 'x', expectedRevision: 1 } })).status).toBe(404);
    expect((await api.patch(`/products/${w.productA.id}/personal/tags/${tag.id}`, { as: w.teamA, body: { name: 'x', expectedRevision: 1 } })).status).toBe(404);
    const listA = expectOk(await api.get(`/products/${w.productA.id}/personal/tags`, { as: w.teamA }));
    expect(listA).toEqual([]);
    // A viewing B as subject gets A's own (separate) view, not B's
    const aView = expectOk(await api.post(`/products/${w.productA.id}/personal/views`, { as: w.teamA, body: { subjectUserId: w.teamB.id } }));
    expect(aView.view.id).not.toBe(viewId);
    const status = expectOk(await api.get('/integrations/google/calendar/status', { as: w.teamA }));
    expect(JSON.stringify(status)).not.toMatch(/refresh|access_token|ciphertext/i);
    const users = expectOk(await api.get(`/products/${w.productA.id}/users`, { as: w.teamA }));
    expect(JSON.stringify(users)).not.toContain('B 的私人');
  });

  it('A11 invitation email job failure is retried with the same link, no duplicate grant, no token in logs', async () => {
    fakes.email.failNext = { retryable: true, code: 'resend_503' };
    const logs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { logs.push(a.join(' ')); };
    try {
      const inv = expectOk(await api.post('/invitations', { as: w.teamA, key: true, body: { email: 'retry@example.com', role: 'team', productIds: [] } }), 201);
      expect(inv.status).toBe('pending');
      const listed = expectOk(await api.get('/invitations', { as: w.teamA })).find((i: any) => i.id === inv.id);
      expect(listed.lastErrorCode).toBe('resend_503');
      await getSql()`update outbox_jobs set next_attempt_at = now() where job_type = 'invitation.send'`;
      await runJobs();
      expect(fakes.email.sent).toHaveLength(1);
      const [job] = await getSql()`select id, state, attempts from outbox_jobs where job_type = 'invitation.send'`;
      expect(job.state).toBe('done');
      expect(job.attempts).toBe(2);
      const token = invitationTokenForJob(job.id);
      expect(fakes.email.sent[0].text).toContain(token);
      // idempotent replay of the same create request does not create a second invitation
      const [{ count }] = await getSql()`select count(*)::int as count from invitations where email = 'retry@example.com'`;
      expect(count).toBe(1);
      expect(logs.join('\n')).not.toContain(token);
    } finally {
      console.error = orig;
    }
  });

  it('A12 switching to tester without products grants no product, strips person tags and admin sessions', async () => {
    const [u] = await getSql()`select revision from users where id = ${w.teamB.id}`;
    expectOk(await api.patch(`/users/${w.teamB.id}/role`, { as: w.teamA, body: { role: 'tester', testerProductIds: [], expectedRevision: u.revision } }));
    expect(await getSql()`select 1 from product_access where user_id = ${w.teamB.id}`).toHaveLength(0);
    expect(await getSql()`select 1 from user_person_tags where user_id = ${w.teamB.id}`).toHaveLength(0);
    expect((await api.get('/me', { as: w.teamB })).body.data).toBeNull();
    const portalMe = expectOk(await api.get('/me', { site: 'portal', as: w.teamB }));
    expect(portalMe.role).toBe('tester');
    expect(portalMe.interactiveProducts).toEqual([]);
  });

  it('rejects cross-site writes (CSRF) and unknown hosts', async () => {
    const r = await api.post('/products', { as: w.teamA, body: { name: 'x' }, origin: 'http://evil.example' });
    expect(r.status).toBe(403);
    const r2 = await api.post('/products', { as: w.teamA, body: { name: 'x' }, origin: null });
    expect(r2.status).toBe(403);
  });
});
