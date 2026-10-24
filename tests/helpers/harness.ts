import { randomUUID } from 'node:crypto';
import { getSql } from '@/server/db';
import { handleApiRequest } from '@/server/api';
import { createSession } from '@/server/session';
import { setEmailProvider, FakeEmailProvider } from '@/server/adapters/email';
import { setGoogleOAuth, FakeGoogleOAuthClient } from '@/server/adapters/google-oauth';
import { setCalendarApi, FakeCalendarApi } from '@/server/adapters/google-calendar';
import { setAvatarStorage, LocalAvatarStorage } from '@/server/adapters/storage';
import { clearAccessCache } from '@/modules/calendar/credentials';
import { bootstrap } from '../../scripts/bootstrap-lib';
import { processJobs } from '@/server/jobs';
import path from 'node:path';
import os from 'node:os';

export const ADMIN = 'http://admin.test.local';
export const PORTAL = 'http://portal.test.local';

export interface Fakes { email: FakeEmailProvider; oauth: FakeGoogleOAuthClient; calendar: FakeCalendarApi }

export function installFakes(): Fakes {
  const fakes = { email: new FakeEmailProvider(), oauth: new FakeGoogleOAuthClient(), calendar: new FakeCalendarApi() };
  setEmailProvider(fakes.email);
  setGoogleOAuth(fakes.oauth);
  setCalendarApi(fakes.calendar);
  setAvatarStorage(new LocalAvatarStorage(path.join(os.tmpdir(), `csb-avatars-${process.pid}`)));
  clearAccessCache();
  return fakes;
}

const TABLES = [
  'idempotency_records', 'calendar_mutations', 'calendar_event_links', 'calendar_bindings', 'google_credentials',
  'notifications', 'outbox_jobs', 'domain_events',
  'personal_feedback_tags', 'personal_feedback_metadata', 'personal_tags', 'personal_placements', 'personal_columns', 'personal_views',
  'roadmap_ranks', 'roadmap_columns', 'roadmaps',
  'schedule_entries', 'schedule_operations', 'schedule_rows', 'schedules',
  'comment_likes', 'feedback_votes', 'comments', 'feedback_person_tags', 'feedback_tags', 'feedback',
  'tags', 'tag_groups', 'user_person_tags', 'person_tags', 'categories', 'statuses',
  'product_access', 'invitation_products', 'invitations', 'products', 'bootstrap_team_grants', 'sessions', 'users',
];

export async function resetDb() {
  await getSql().unsafe(`truncate ${TABLES.join(', ')} restart identity cascade`);
}

export interface TestUser { id: string; email: string; name: string; sub: string; admin: string; portal: string }

let counter = 0;

/** Create an account the way login does, plus a session on each site. */
export async function makeUser(role: 'team' | 'tester' | 'none', name: string, productIds: string[] = []): Promise<TestUser> {
  const sql = getSql();
  counter++;
  const sub = `sub${counter}x${Date.now().toString(36)}`;
  const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'}${counter}@example.com`;
  const [u] = await sql<{ id: string }[]>`
    insert into users (google_sub, verified_email, display_name, role) values (${sub}, ${email}, ${name}, ${role}) returning id
  `;
  for (const p of productIds) await sql`insert into product_access (user_id, product_id) values (${u.id}, ${p})`;
  const admin = await createSession(sql, u.id, 'admin');
  const portal = await createSession(sql, u.id, 'portal');
  return { id: u.id, email, name, sub, admin, portal };
}

export interface CallOpts {
  as?: TestUser | null;
  site?: 'admin' | 'portal';
  body?: unknown;
  headers?: Record<string, string>;
  key?: string | boolean;
  ifMatch?: number | string;
  origin?: string | null;
}

export interface ApiResult<T = any> { status: number; body: { data: T; meta: any; error: any }; headers: Headers }

export async function call<T = any>(method: string, path: string, opts: CallOpts = {}): Promise<ApiResult<T>> {
  const site = opts.site ?? 'admin';
  const origin = site === 'admin' ? ADMIN : PORTAL;
  const headers: Record<string, string> = { host: new URL(origin).host, ...(opts.headers ?? {}) };
  if (opts.origin !== null) headers.origin = opts.origin ?? origin;
  if (opts.as) {
    const session = `csb_session=${site === 'admin' ? opts.as.admin : opts.as.portal}`;
    headers.cookie = headers.cookie ? `${session}; ${headers.cookie}` : session;
  }
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.key) headers['idempotency-key'] = opts.key === true ? randomUUID() : opts.key;
  if (opts.ifMatch !== undefined) headers['if-match'] = `"${opts.ifMatch}"`;
  const res = await handleApiRequest(new Request(`${origin}/api/v1${path}`, {
    method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

export const api = {
  get: <T = any>(p: string, o?: CallOpts) => call<T>('GET', p, o),
  post: <T = any>(p: string, o?: CallOpts) => call<T>('POST', p, o),
  patch: <T = any>(p: string, o?: CallOpts) => call<T>('PATCH', p, o),
  put: <T = any>(p: string, o?: CallOpts) => call<T>('PUT', p, o),
  del: <T = any>(p: string, o?: CallOpts) => call<T>('DELETE', p, o),
};

export function expectOk(r: ApiResult, status?: number) {
  if (r.status >= 400 || (status !== undefined && r.status !== status)) {
    throw new Error(`Expected success${status ? ` ${status}` : ''}, got ${r.status}: ${JSON.stringify(r.body)}`);
  }
  return r.body.data;
}

export async function runJobs() {
  return processJobs({ limit: 100 });
}

export interface World {
  productA: { id: string; slug: string };
  productB: { id: string; slug: string };
  teamA: TestUser;
  teamB: TestUser;
  tester: TestUser;
  outsider: TestUser;
  tax: any;
  ptUiux: string;
  ptFront: string;
  ptBack: string;
  v10: string;
  v11: string;
  versionGroup: string;
  usageGroup: string;
  perf: string;
  ui: string;
  loose: string;
}

/** Shared acceptance dataset (docs/07): products 甲/乙, two team members, one tester, one outsider. */
export async function seedWorld(): Promise<World> {
  await bootstrap(getSql(), { teamEmail: null });
  const sql = getSql();
  const [pa] = await sql<{ id: string; slug: string }[]>`select id, slug from products where system_key = 'initial'`;
  await sql`update products set name = '產品甲' where id = ${pa.id}`;
  const teamA = await makeUser('team', 'Team A');
  const teamB = await makeUser('team', 'Team B');
  const pb = expectOk(await api.post('/products', { as: teamA, body: { name: '產品乙' } }));
  const tester = await makeUser('tester', 'Tester', [pa.id]);
  const outsider = await makeUser('none', 'Outsider');
  let tax = expectOk(await api.get(`/products/${pa.id}/taxonomy`, { as: teamA }));
  const add = async (path: string, body: Record<string, unknown>) => {
    const res = expectOk(await api.post(`/products/${pa.id}/${path}`, { as: teamA, body: { ...body, expectedRevision: tax.productRevision } }));
    tax = expectOk(await api.get(`/products/${pa.id}/taxonomy`, { as: teamA }));
    return res;
  };
  const ptUiux = (await add('person-tags', { name: 'UIUX' })).personTag.id;
  const ptFront = (await add('person-tags', { name: '前端' })).personTag.id;
  const ptBack = (await add('person-tags', { name: '後端' })).personTag.id;
  const versionGroup = tax.tagGroups.find((g: any) => g.systemKey === 'version').id;
  const v10 = (await add('tags', { name: 'v1.0', groupId: versionGroup })).tag.id;
  const v11 = (await add('tags', { name: 'v1.1', groupId: versionGroup })).tag.id;
  const usageGroup = (await add('tag-groups', { name: '用途', selectionMode: 'multiple' })).group.id;
  const perf = (await add('tags', { name: '效能', groupId: usageGroup })).tag.id;
  const ui = (await add('tags', { name: '介面', groupId: usageGroup })).tag.id;
  const loose = (await add('tags', { name: '未分組標籤', groupId: null })).tag.id;
  // team A and B both hold UIUX; team A also holds 前端
  expectOk(await api.put(`/products/${pa.id}/users/${teamA.id}/person-tags`, { as: teamA, body: { personTagIds: [ptUiux, ptFront], expectedRevision: tax.productRevision } }));
  tax = expectOk(await api.get(`/products/${pa.id}/taxonomy`, { as: teamA }));
  expectOk(await api.put(`/products/${pa.id}/users/${teamB.id}/person-tags`, { as: teamA, body: { personTagIds: [ptUiux], expectedRevision: tax.productRevision } }));
  tax = expectOk(await api.get(`/products/${pa.id}/taxonomy`, { as: teamA }));
  return {
    productA: { id: pa.id, slug: pa.slug }, productB: { id: pb.id, slug: pb.slug }, teamA, teamB, tester, outsider, tax,
    ptUiux, ptFront, ptBack, v10, v11, versionGroup, usageGroup, perf, ui, loose,
  };
}

export async function refreshTax(w: World) {
  w.tax = expectOk(await api.get(`/products/${w.productA.id}/taxonomy`, { as: w.teamA }));
  return w.tax;
}

export async function createFeedback(w: World, body: Record<string, unknown>, as: TestUser = w.teamA, productId = w.productA.id) {
  return expectOk(await api.post(`/products/${productId}/feedback`, { as, body: { title: '測試回饋', ...body }, key: true }), 201);
}
