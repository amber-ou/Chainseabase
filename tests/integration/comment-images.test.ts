import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { LocalAvatarStorage, setAvatarStorage } from '@/server/adapters/storage';
import { getSql } from '@/server/db';
import { handleApiRequest } from '@/server/api';
import { ADMIN, api, createFeedback, expectOk, getBytes, installFakes, makeUser, resetDb, runJobs, seedWorld, uploadImage, type ApiResult, type TestUser, type World } from '../helpers/harness';

/**
 * Follow-up batch 2026-11-10: DETAIL-03 (editing a Feedback's images updates the same Feedback) and
 * COMMENT-05/06 (comment images: limits, attachment, reads that follow the Feedback's current access on
 * every request, and the file lifecycle). Storage is the test double (mock), on disk.
 */
let w: World;
let root: string;
beforeAll(() => { installFakes(); });
beforeEach(async () => {
  await resetDb();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-cmimg-'));
  setAvatarStorage(new LocalAvatarStorage(root));
  w = await seedWorld();
});

const png = (width = 64, height = 48) => sharp({ create: { width, height, channels: 3, background: '#3366aa' } }).png().toBuffer();
const P = () => `/products/${w.productA.id}`;
const dir = (folder: string) => path.join(root, folder, w.productA.id);
const files = (folder: string) => (fs.existsSync(dir(folder)) ? fs.readdirSync(dir(folder)).sort() : []);

async function uploadCommentImage(as: TestUser, productId: string, data: Buffer, type = 'image/png', site: 'admin' = 'admin') {
  const res = await handleApiRequest(new Request(`${ADMIN}/api/v1/products/${productId}/comment-images`, {
    method: 'POST', body: new Uint8Array(data),
    headers: { host: new URL(ADMIN).host, origin: ADMIN, cookie: `csb_session=${site === 'admin' ? as.admin : as.portal}`, 'content-type': type },
  }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers } as ApiResult;
}
async function commentWith(feedbackId: string, n: number, as: TestUser = w.teamA) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(expectOk(await uploadCommentImage(as, w.productA.id, await png()), 201).id);
  const c = expectOk(await api.post(`${P()}/feedback/${feedbackId}/comments`, { as, body: { body: '附圖留言', imageIds: ids } }), 201);
  return { c, ids };
}

describe('DETAIL-03 editing a Feedback\'s images updates the same Feedback', () => {
  it('keeps, reorders, adds and removes images on the same row; removed files are deleted; no copy is created', async () => {
    const a = expectOk(await uploadImage(w.teamA, w.productA.id, await png()), 201).id;
    const b = expectOk(await uploadImage(w.teamA, w.productA.id, await png()), 201).id;
    const f = await createFeedback(w, { title: '編輯圖片', imageIds: [a, b] });
    const before = (await getSql()`select count(*)::int as n from feedback`)[0].n;
    const c = expectOk(await uploadImage(w.teamB, w.productA.id, await png()), 201).id;
    // another team member edits: drops a, keeps b, adds their own pending c first
    const cur = expectOk(await api.get(`${P()}/feedback/${f.id}`, { as: w.teamB }));
    const r = expectOk(await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamB, body: { title: '已編輯', imageIds: [c, b], expectedRevision: cur.revision } }));
    expect(r.id).toBe(f.id);
    expect(r.title).toBe('已編輯');
    expect(r.revision).toBe(cur.revision + 1);
    expect((await getSql()`select count(*)::int as n from feedback`)[0].n).toBe(before);
    expect(expectOk(await api.get(`${P()}/feedback/${f.id}/images`, { as: w.teamA })).map((i: { id: string }) => i.id)).toEqual([c, b]);
    await runJobs();
    expect(files('feedback-images').some((n) => n.startsWith(a))).toBe(false);
    expect((await getBytes(`${P()}/feedback/${f.id}/images/${a}/original`, { as: w.teamA })).status).toBe(404);
  });

  it('refuses another person\'s pending image, more than 5, duplicates and a stale revision, changing nothing', async () => {
    const a = expectOk(await uploadImage(w.teamA, w.productA.id, await png()), 201).id;
    const f = await createFeedback(w, { title: '不變', imageIds: [a] });
    const cur = expectOk(await api.get(`${P()}/feedback/${f.id}`, { as: w.teamA }));
    const others = expectOk(await uploadImage(w.teamB, w.productA.id, await png()), 201).id;
    expect((await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { title: '改了', imageIds: [a, others], expectedRevision: cur.revision } })).status).toBe(400);
    expect((await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { imageIds: [a, a], expectedRevision: cur.revision } })).status).toBe(400);
    const six: string[] = [];
    for (let i = 0; i < 5; i++) six.push(expectOk(await uploadImage(w.teamA, w.productA.id, await png()), 201).id);
    expect((await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { imageIds: [a, ...six], expectedRevision: cur.revision } })).status).toBe(400);
    expect((await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { imageIds: [], expectedRevision: cur.revision - 1 } })).status).toBe(409);
    const after = expectOk(await api.get(`${P()}/feedback/${f.id}`, { as: w.teamA }));
    expect([after.title, after.revision]).toEqual(['不變', cur.revision]);
    expect(expectOk(await api.get(`${P()}/feedback/${f.id}/images`, { as: w.teamA })).map((i: { id: string }) => i.id)).toEqual([a]);
    // the portal edit cannot touch images at all (only title and description are accepted)
    expect((await api.patch(`/portal/products/${w.productA.id}/feedback/${f.id}`, { site: 'portal', as: w.tester, body: { imageIds: [], expectedRevision: cur.revision } })).status).toBe(400);
  });
});

describe('COMMENT-05 limits and attachment', () => {
  it('JPEG, PNG and WebP by real content, 5 MB each, at most 5 per comment; others refused and nothing posted', async () => {
    const f = await createFeedback(w, { title: '留言圖片' });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect((await uploadCommentImage(w.teamA, w.productA.id, svg, 'image/png')).status).toBe(400);
    expect((await uploadCommentImage(w.teamA, w.productA.id, Buffer.concat([await png(), Buffer.alloc(5 * 1024 * 1024)]))).status).toBe(400);
    const webp = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#0a0' } }).webp().toBuffer();
    expect(expectOk(await uploadCommentImage(w.teamA, w.productA.id, webp, 'image/webp'), 201).contentType).toBe('image/webp');
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(expectOk(await uploadCommentImage(w.teamA, w.productA.id, await png()), 201).id);
    const post = (body: Record<string, unknown>, as = w.teamA) => api.post(`${P()}/feedback/${f.id}/comments`, { as, body: { body: '文字', ...body } });
    expect((await post({ imageIds: ids })).status).toBe(400);
    expect((await post({ imageIds: [ids[0], ids[0]] })).status).toBe(400);
    expect((await post({ imageIds: [ids[0]] }, w.teamB)).status).toBe(400); // someone else's pending image
    // a Feedback image (pending) is not a comment image
    const fbImg = expectOk(await uploadImage(w.teamA, w.productA.id, await png()), 201).id;
    expect((await post({ imageIds: [fbImg] })).status).toBe(400);
    expect((await getSql()`select 1 from comments where feedback_id = ${f.id}`).length).toBe(0);
    const ok = expectOk(await post({ imageIds: ids.slice(0, 5) }), 201);
    expect(ok.images.map((i: { id: string }) => i.id)).toEqual(ids.slice(0, 5));
    const list = expectOk(await api.get(`${P()}/feedback/${f.id}/comments`, { as: w.teamB }));
    expect(list[0].images).toHaveLength(5);
  });

  it('only team members upload on the admin site; the portal comment API does not take images', async () => {
    expect((await uploadCommentImage(w.tester, w.productA.id, await png())).status).toBe(403);
    expect((await uploadCommentImage(w.outsider, w.productA.id, await png())).status).toBe(403);
    const f = await createFeedback(w, { title: '公開', visibility: 'public' });
    const id = expectOk(await uploadCommentImage(w.teamA, w.productA.id, await png()), 201).id;
    expect((await api.post(`/portal/products/${w.productA.id}/feedback/${f.id}/comments`, { site: 'portal', as: w.tester, body: { body: 'x', imageIds: [id] } })).status).toBe(400);
  });
});

describe('COMMENT-06 reads follow the Feedback\'s current access, on every request', () => {
  it('team reads on the admin API with no-store headers; signed out, testers and wrong ids get nothing', async () => {
    const f = await createFeedback(w, { title: '內部' });
    const { c, ids } = await commentWith(f.id, 1);
    const url = `${P()}/comments/${c.id}/images/${ids[0]}/thumb`;
    const r = await getBytes(url, { as: w.teamB });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(r.headers.get('vary')).toContain('Cookie');
    expect((await sharp(r.data).metadata()).format).toBe('webp');
    expect((await getBytes(url)).status).toBe(401);
    expect((await getBytes(url, { as: w.tester })).status).toBe(403);
    const other = await commentWith(f.id, 0);
    expect((await getBytes(`${P()}/comments/${other.c.id}/images/${ids[0]}/original`, { as: w.teamA })).status).toBe(404);
    expect((await getBytes(`/products/${w.productB.id}/comments/${c.id}/images/${ids[0]}/original`, { as: w.teamA })).status).toBe(404);
  });

  it('portal: only while the Feedback is public, only invited members; internal again or removed member: refused at once', async () => {
    const f = await createFeedback(w, { title: '先內部' });
    const { c, ids } = await commentWith(f.id, 1);
    const pub = (who: TestUser | null = w.tester) => getBytes(`/public/products/${w.productA.slug}/comments/${c.id}/images/${ids[0]}/original`, { as: who, site: 'portal' });
    expect((await pub()).status).toBe(404);
    let cur = expectOk(await api.get(`${P()}/feedback/${f.id}`, { as: w.teamA }));
    expectOk(await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { visibility: 'public', expectedRevision: cur.revision } }));
    expect((await pub()).status).toBe(200);
    // the public comment list carries the images too
    const list = expectOk(await api.get(`/public/products/${w.productA.slug}/feedback/${f.id}/comments`, { site: 'portal', as: w.tester }));
    expect(list[0].images.map((i: { id: string }) => i.id)).toEqual(ids);
    const otherTester = await makeUser('tester', '別產品測試者', [w.productB.id]);
    expect((await pub(otherTester)).status).toBe(404);
    expect((await pub(w.outsider)).status).toBe(404);
    expect((await pub(null)).status).toBe(401);
    cur = expectOk(await api.get(`${P()}/feedback/${f.id}`, { as: w.teamA }));
    expectOk(await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { visibility: 'internal', expectedRevision: cur.revision } }));
    expect((await pub()).status).toBe(404);
    expectOk(await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { visibility: 'public', expectedRevision: cur.revision + 1 } }));
    expect((await pub()).status).toBe(200);
    await getSql()`delete from product_access where user_id = ${w.tester.id} and product_id = ${w.productA.id}`;
    expect((await pub()).status).toBe(404);
  });

  it('pending comment images have no read route and are not under public/', async () => {
    const pending = expectOk(await uploadCommentImage(w.teamA, w.productA.id, await png()), 201);
    const f = await createFeedback(w, { title: 'x' });
    const { c } = await commentWith(f.id, 0);
    expect((await getBytes(`${P()}/comments/${c.id}/images/${pending.id}/original`, { as: w.teamA })).status).toBe(404);
    expect(fs.existsSync(path.join(process.cwd(), 'public', 'comment-images'))).toBe(false);
  });
});

describe('COMMENT-06 file lifecycle', () => {
  it('removing a pending image deletes its files; only the uploader can', async () => {
    const a = expectOk(await uploadCommentImage(w.teamA, w.productA.id, await png()), 201);
    expect(files('comment-images')).toHaveLength(2);
    expect((await api.del(`${P()}/comment-images/${a.id}`, { as: w.teamB })).status).toBe(404);
    expectOk(await api.del(`${P()}/comment-images/${a.id}`, { as: w.teamA }));
    await runJobs();
    expect(files('comment-images')).toEqual([]);
  });

  it('removing the comment, deleting the Feedback, or old pending uploads remove rows and files; others stay', async () => {
    const f1 = await createFeedback(w, { title: '一' });
    const f2 = await createFeedback(w, { title: '二' });
    const one = await commentWith(f1.id, 1);
    const two = await commentWith(f1.id, 1);
    const three = await commentWith(f2.id, 1);
    expect(files('comment-images')).toHaveLength(6);
    // attached images cannot be removed as pending
    expect((await api.del(`${P()}/comment-images/${one.ids[0]}`, { as: w.teamA })).status).toBe(404);
    expectOk(await api.del(`${P()}/comments/${one.c.id}`, { as: w.teamA, ifMatch: one.c.revision }));
    await runJobs();
    expect(files('comment-images')).toHaveLength(4);
    expect((await getBytes(`${P()}/comments/${one.c.id}/images/${one.ids[0]}/original`, { as: w.teamA })).status).toBe(404);
    const cur = expectOk(await api.get(`${P()}/feedback/${f1.id}`, { as: w.teamA }));
    expectOk(await api.del(`${P()}/feedback/${f1.id}`, { as: w.teamA, ifMatch: cur.revision }));
    await runJobs();
    expect(files('comment-images').every((n) => n.startsWith(three.ids[0]))).toBe(true);
    expect((await getSql()`select 1 from comment_images where id = ${two.ids[0]}`).length).toBe(0);
    expect((await getBytes(`${P()}/comments/${three.c.id}/images/${three.ids[0]}/thumb`, { as: w.teamA })).status).toBe(200);
    const old = expectOk(await uploadCommentImage(w.teamA, w.productA.id, await png()), 201);
    await getSql()`update comment_images set created_at = now() - interval '25 hours' where id = ${old.id}`;
    expectOk(await uploadCommentImage(w.teamA, w.productA.id, await png()), 201);
    await runJobs();
    expect((await getSql()`select 1 from comment_images where id = ${old.id}`).length).toBe(0);
  });
});
