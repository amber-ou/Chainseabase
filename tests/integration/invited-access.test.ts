import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { handleApiRequest } from '@/server/api';
import { getSql } from '@/server/db';
import {
  PORTAL, api, createFeedback, expectOk, installFakes, makeUser, resetDb, seedWorld, type TestUser, type World,
} from '../helpers/harness';

/**
 * WIN-04: company content is for invited members only (docs/windows-native-deployment.md, 存取規則變更).
 * Anonymous callers, uninvited Google accounts and removed members get no content from the portal
 * projection, search, avatars or notifications; testers stay inside their invited products.
 */
let w: World;
let fb: { id: string };
let roadmapId: string;
let columnId: string;
let testerB: TestUser;

beforeAll(() => { installFakes(); });
beforeEach(async () => {
  await resetDb();
  w = await seedWorld();
  fb = await createFeedback(w, { visibility: 'public', title: '受邀才能看的需求' });
  expectOk(await api.post(`/products/${w.productA.id}/feedback/${fb.id}/comments`, { as: w.teamA, body: { body: '受邀才能看的留言' } }), 201);
  const rms = expectOk(await api.get(`/products/${w.productA.id}/roadmaps`, { as: w.teamA }));
  expectOk(await api.patch(`/products/${w.productA.id}/roadmaps/${rms[0].id}`, { as: w.teamA, body: { portalPublished: true, expectedRevision: rms[0].revision } }));
  roadmapId = rms[0].id;
  const board = expectOk(await api.get(`/public/products/${w.productA.slug}/roadmaps/${roadmapId}`, { site: 'portal', as: w.tester }));
  columnId = board.columns[0].id;
  testerB = await makeUser('tester', 'Tester B', [w.productB.id]);
});

const CONTENT = ['受邀才能看的需求', '受邀才能看的留言', '產品甲', '產品乙'];

function readPaths(slug: string) {
  return [
    `/public/products/${slug}`,
    `/public/products/${slug}/feedback`,
    `/public/products/${slug}/feedback?q=${encodeURIComponent('受邀')}`,
    `/public/products/${slug}/feedback/${fb.id}`,
    `/public/products/${slug}/feedback/${fb.id}/comments`,
    `/public/products/${slug}/roadmaps`,
    `/public/products/${slug}/roadmaps/${roadmapId}`,
    `/public/products/${slug}/roadmaps/${roadmapId}/columns/${columnId}/feedback`,
  ];
}

async function removeMember(user: TestUser) {
  const [{ revision }] = await getSql()<{ revision: number }[]>`select revision from users where id = ${user.id}`;
  expectOk(await api.del(`/users/${user.id}/membership`, { as: w.teamA, ifMatch: revision }));
}

describe('WIN-04 invited-only reads', () => {
  it('anonymous callers get 401 and no content on both hosts, including the product list and search', async () => {
    for (const site of ['portal', 'admin'] as const) {
      for (const path of ['/public/products', ...readPaths(w.productA.slug)]) {
        const r = await api.get(path, { site });
        expect(r.status, `${site} ${path}`).toBe(401);
        expect(r.body.error.code).toBe('AUTH_REQUIRED');
        for (const leak of CONTENT) expect(JSON.stringify(r.body), path).not.toContain(leak);
      }
    }
  });

  it('uninvited accounts get the 404 of an unknown resource, and an empty product list', async () => {
    expect(expectOk(await api.get('/public/products', { site: 'portal', as: w.outsider }))).toEqual([]);
    for (const path of readPaths(w.productA.slug)) {
      const r = await api.get(path, { site: 'portal', as: w.outsider });
      const unknown = await api.get(path.replace(w.productA.slug, 'no-such-product'), { site: 'portal', as: w.outsider });
      expect(r.status, path).toBe(404);
      expect({ ...r.body.error, requestId: null }).toEqual({ ...unknown.body.error, requestId: null });
      for (const leak of CONTENT) expect(JSON.stringify(r.body), path).not.toContain(leak);
    }
  });

  it('a removed member loses every read on the next request (tester and team)', async () => {
    expect(expectOk(await api.get(`/public/products/${w.productA.slug}/feedback`, { site: 'portal', as: w.tester })).map((f: any) => f.id)).toContain(fb.id);
    await removeMember(w.tester);
    // removeMembership also revokes sessions; keep one alive to prove the membership check itself holds
    await getSql()`update sessions set revoked_at = null where user_id = ${w.tester.id}`;
    expect(expectOk(await api.get('/public/products', { site: 'portal', as: w.tester }))).toEqual([]);
    for (const path of readPaths(w.productA.slug)) {
      const r = await api.get(path, { site: 'portal', as: w.tester });
      expect(r.status, path).toBe(404);
      for (const leak of CONTENT) expect(JSON.stringify(r.body), path).not.toContain(leak);
    }
    expect((await api.get(`/portal/products/${w.productA.id}/notifications`, { site: 'portal', as: w.tester })).status).toBe(404);
    // the account itself can still see why
    expect(expectOk(await api.get('/me', { site: 'portal', as: w.tester })).role).toBe('none');

    expectOk(await api.get(`/public/products/${w.productA.slug}`, { site: 'portal', as: w.teamB }));
    await removeMember(w.teamB);
    await getSql()`update sessions set revoked_at = null where user_id = ${w.teamB.id}`;
    expect((await api.get(`/public/products/${w.productA.slug}`, { site: 'portal', as: w.teamB })).status).toBe(404);
    expect((await api.get(`/products/${w.productA.id}/feedback`, { as: w.teamB })).status).toBe(403);
  });

  it('testers stay inside invited products: other products answer 404 exactly like unknown ones', async () => {
    const products = expectOk(await api.get('/public/products', { site: 'portal', as: w.tester }));
    expect(products.map((p: any) => p.slug)).toEqual([w.productA.slug]);
    for (const path of readPaths(w.productB.slug)) {
      const other = await api.get(path, { site: 'portal', as: w.tester });
      const unknown = await api.get(path.replace(w.productB.slug, 'no-such-product'), { site: 'portal', as: w.tester });
      expect(other.status, path).toBe(404);
      expect({ ...other.body.error, requestId: null }).toEqual({ ...unknown.body.error, requestId: null });
    }
    // and the reverse: tester B cannot read product A, nor find its content by search
    expect((await api.get(`/public/products/${w.productA.slug}/feedback?q=${encodeURIComponent('受邀')}`, { site: 'portal', as: testerB })).status).toBe(404);
    // revoking product access takes effect on the next request
    const [{ revision }] = await getSql()<{ revision: number }[]>`select revision from users where id = ${w.tester.id}`;
    expectOk(await api.patch(`/users/${w.tester.id}/role`, { as: w.teamA, body: { role: 'tester', testerProductIds: [w.productB.id], expectedRevision: revision } }));
    expect((await api.get(`/public/products/${w.productA.slug}/feedback/${fb.id}`, { site: 'portal', as: w.tester })).status).toBe(404);
    expect(expectOk(await api.get('/public/products', { site: 'portal', as: w.tester })).map((p: any) => p.slug)).toEqual([w.productB.slug]);
  });

  it('team members read every product projection; tester reads keep the team/tester field boundary', async () => {
    expect(expectOk(await api.get('/public/products', { site: 'portal', as: w.teamA })).map((p: any) => p.slug).sort()).toEqual([w.productA.slug, w.productB.slug].sort());
    const r = await api.get(`/public/products/${w.productA.slug}/feedback/${fb.id}`, { site: 'portal', as: w.tester });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    for (const internal of ['priority', 'personTags', 'visibility', 'schedule', 'email']) expect(JSON.stringify(r.body)).not.toContain(internal);
    // admin-only APIs stay closed to testers
    expect((await api.get(`/products/${w.productA.id}/feedback`, { as: w.tester })).status).toBe(403);
  });
});

describe('WIN-04 avatars and caching', () => {
  async function upload(user: TestUser) {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#224466' } }).png().toBuffer();
    return handleApiRequest(new Request(`${PORTAL}/api/v1/me/avatar-upload`, {
      method: 'POST', body: new Uint8Array(png),
      headers: { host: new URL(PORTAL).host, origin: PORTAL, cookie: `csb_session=${user.portal}`, 'content-type': 'image/png' },
    }));
  }
  function avatar(id: string, as: TestUser | null, headers: Record<string, string> = {}) {
    return handleApiRequest(new Request(`${PORTAL}/api/v1/avatars/${id}`, {
      headers: { host: new URL(PORTAL).host, ...(as ? { cookie: `csb_session=${as.portal}` } : {}), ...headers },
    }));
  }

  it('only members fetch avatars; testers see self, team and co-members, not people of other products', async () => {
    for (const u of [w.teamA, w.tester, testerB]) expect((await upload(u)).status).toBe(200);
    expect((await upload(w.outsider)).status).toBe(403);
    expect((await avatar(w.teamA.id, null)).status).toBe(401);
    expect((await avatar(w.teamA.id, w.outsider)).status).toBe(404);
    for (const target of [w.tester, w.teamA]) expect((await avatar(target.id, w.tester)).status).toBe(200);
    // tester B is only in product B: invisible to the product A tester, like a user without an avatar
    expect((await avatar(testerB.id, w.tester)).status).toBe(404);
    expect((await avatar(testerB.id, w.teamA)).status).toBe(200);
    // a co-member of product B becomes visible once invited there
    await getSql()`insert into product_access (user_id, product_id) values (${w.tester.id}, ${w.productB.id})`;
    expect((await avatar(testerB.id, w.tester)).status).toBe(200);
  });

  it('avatar responses are private, revalidated on every use and never answered from cache without a session', async () => {
    expect((await upload(w.teamA)).status).toBe(200);
    const first = await avatar(w.teamA.id, w.tester);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    expect(first.headers.get('vary')).toBe('Cookie');
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{16}\.webp"$/);
    const revalidated = await avatar(w.teamA.id, w.tester, { 'if-none-match': etag });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe('');
    // the same conditional request without a session, or from an uninvited account, is still refused
    expect((await avatar(w.teamA.id, null, { 'if-none-match': etag })).status).toBe(401);
    expect((await avatar(w.teamA.id, w.outsider, { 'if-none-match': etag })).status).toBe(404);
  });
});

describe('WIN-04 notifications and portal writes need membership first', () => {
  it('uninvited and anonymous callers cannot probe product IDs through portal writes or notifications', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const id of [w.productA.id, unknown]) {
      expect((await api.get(`/portal/products/${id}/notifications`, { site: 'portal' })).status).toBe(401);
      const n = await api.get(`/portal/products/${id}/notifications`, { site: 'portal', as: w.outsider });
      expect(n.status).toBe(404);
      const write = await api.post(`/portal/products/${id}/feedback`, { site: 'portal', as: w.outsider, key: true, body: { title: 'x' } });
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe('NOT_A_MEMBER');
    }
  });
});
