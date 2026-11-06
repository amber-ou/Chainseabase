import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { LocalAvatarStorage, setAvatarStorage } from '@/server/adapters/storage';
import { getSql } from '@/server/db';
import { api, createFeedback, expectOk, getBytes, installFakes, makeUser, resetDb, runJobs, seedWorld, uploadImage, type World } from '../helpers/harness';

/**
 * Phase 2 IM01-IM06 (2026-11-06): Feedback images. Format, size and count limits on the server,
 * attachment on creation, and reads that follow the Feedback's current access on every request,
 * with no cache that another account could reuse. Storage is the test double (mock), on disk.
 */
let w: World;
let root: string;
beforeAll(() => { installFakes(); });
beforeEach(async () => {
  await resetDb();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-fbimg-'));
  setAvatarStorage(new LocalAvatarStorage(root));
  w = await seedWorld();
});

const png = (width = 64, height = 48) => sharp({ create: { width, height, channels: 3, background: '#3366aa' } }).png().toBuffer();
const P = () => `/products/${w.productA.id}`;
const files = () => (fs.existsSync(path.join(root, 'feedback-images')) ? fs.readdirSync(path.join(root, 'feedback-images', w.productA.id)).sort() : []);

async function withImages(n: number, body: Record<string, unknown> = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(expectOk(await uploadImage(w.teamA, w.productA.id, await png()), 201).id);
  const f = await createFeedback(w, { title: '有圖片', imageIds: ids, ...body });
  return { f, ids };
}

describe('IM01 limits, decided by the real content', () => {
  it('accepts JPEG, PNG and WebP; removes metadata; keeps the format and makes a WebP thumbnail', async () => {
    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#aa3366' } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret-gps' } } }).toBuffer();
    const webp = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#00aa00' } }).webp().toBuffer();
    const a = expectOk(await uploadImage(w.teamA, w.productA.id, jpeg, 'image/jpeg'), 201);
    const b = expectOk(await uploadImage(w.teamA, w.productA.id, webp, 'image/webp'), 201);
    expect([a.contentType, a.width, a.height]).toEqual(['image/jpeg', 800, 600]);
    expect(b.contentType).toBe('image/webp');
    const f = await createFeedback(w, { title: '格式', imageIds: [a.id, b.id] });
    const orig = await getBytes(`${P()}/feedback/${f.id}/images/${a.id}/original`, { as: w.teamA });
    expect(orig.status).toBe(200);
    expect(orig.headers.get('content-type')).toBe('image/jpeg');
    const meta = await sharp(orig.data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 800, 600]);
    expect(meta.exif).toBeUndefined();
    const thumb = await getBytes(`${P()}/feedback/${f.id}/images/${a.id}/thumb`, { as: w.teamA });
    const tm = await sharp(thumb.data).metadata();
    expect([tm.format, Math.max(tm.width!, tm.height!)]).toEqual(['webp', 320]);
  });

  it('refuses SVG, GIF, a spoofed type, an empty file and files over 5 MB', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect((await uploadImage(w.teamA, w.productA.id, svg, 'image/svg+xml')).status).toBe(400);
    expect((await uploadImage(w.teamA, w.productA.id, svg, 'image/png')).status).toBe(400);
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).gif().toBuffer();
    expect((await uploadImage(w.teamA, w.productA.id, gif, 'image/png')).status).toBe(400);
    // PNG bytes declared as JPEG: the declared type is accepted, but the real content decides the stored type
    const asJpeg = expectOk(await uploadImage(w.teamA, w.productA.id, await png(), 'image/jpeg'), 201);
    expect(asJpeg.contentType).toBe('image/png');
    expect((await uploadImage(w.teamA, w.productA.id, Buffer.alloc(0))).status).toBe(400);
    const big = Buffer.concat([await png(), Buffer.alloc(5 * 1024 * 1024)]);
    const r = await uploadImage(w.teamA, w.productA.id, big);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('5 MB');
  });

  it('at most 5 per Feedback; duplicates and another person\'s pending images are refused', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(expectOk(await uploadImage(w.teamA, w.productA.id, await png()), 201).id);
    expect((await api.post(`${P()}/feedback`, { as: w.teamA, key: true, body: { title: '太多', imageIds: ids } })).status).toBe(400);
    expect((await api.post(`${P()}/feedback`, { as: w.teamA, key: true, body: { title: '重複', imageIds: [ids[0], ids[0]] } })).status).toBe(400);
    const others = expectOk(await uploadImage(w.teamB, w.productA.id, await png()), 201);
    const r = await api.post(`${P()}/feedback`, { as: w.teamA, key: true, body: { title: '別人的', imageIds: [others.id] } });
    expect(r.status).toBe(400);
    // a refused creation stores nothing: no Feedback and the images stay pending
    expect((await getSql()`select 1 from feedback where title in ('太多', '重複', '別人的')`).length).toBe(0);
    expect((await getSql()`select 1 from feedback_images where feedback_id is not null`).length).toBe(0);
    // another product's pending image cannot be used either
    const other = expectOk(await uploadImage(w.teamA, w.productB.id, await png()), 201);
    expect((await api.post(`${P()}/feedback`, { as: w.teamA, key: true, body: { title: '別的產品', imageIds: [other.id] } })).status).toBe(400);
  });

  it('only team members upload, and only on the admin site', async () => {
    expect((await uploadImage(w.tester, w.productA.id, await png())).status).toBe(403);
    expect((await uploadImage(w.outsider, w.productA.id, await png())).status).toBe(403);
  });
});

describe('IM03/IM04 access follows the Feedback, on every read', () => {
  it('team reads through the admin API; nothing is cacheable by shared caches or across accounts', async () => {
    const { f, ids } = await withImages(2);
    const list = expectOk(await api.get(`${P()}/feedback/${f.id}/images`, { as: w.teamA }));
    expect(list.map((i: { id: string }) => i.id)).toEqual(ids);
    const r = await getBytes(`${P()}/feedback/${f.id}/images/${ids[1]}/thumb`, { as: w.teamB });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(r.headers.get('vary')).toContain('Cookie');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    // signed out, a tester on the admin API, the wrong feedback or product: nothing
    expect((await getBytes(`${P()}/feedback/${f.id}/images/${ids[1]}/thumb`)).status).toBe(401);
    expect((await getBytes(`${P()}/feedback/${f.id}/images/${ids[1]}/thumb`, { as: w.tester })).status).toBe(403);
    const other = await createFeedback(w, { title: '別筆' });
    expect((await getBytes(`${P()}/feedback/${other.id}/images/${ids[1]}/original`, { as: w.teamA })).status).toBe(404);
    expect((await getBytes(`/products/${w.productB.id}/feedback/${f.id}/images/${ids[1]}/original`, { as: w.teamA })).status).toBe(404);
  });

  it('internal Feedback images never reach the portal; public ones do until the Feedback is made internal', async () => {
    const { f, ids } = await withImages(1, { visibility: 'internal' });
    const pub = (who = w.tester) => getBytes(`/public/products/${w.productA.slug}/feedback/${f.id}/images/${ids[0]}/original`, { as: who, site: 'portal' });
    expect((await pub()).status).toBe(404);
    expect((await api.get(`/public/products/${w.productA.slug}/feedback/${f.id}/images`, { site: 'portal', as: w.tester })).status).toBe(404);
    // made public: the invited tester can read it, a tester of another product and the uninvited cannot
    let cur = expectOk(await api.get(`${P()}/feedback/${f.id}`, { as: w.teamA }));
    expectOk(await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { visibility: 'public', expectedRevision: cur.revision } }));
    expect((await pub()).status).toBe(200);
    expect(expectOk(await api.get(`/public/products/${w.productA.slug}/feedback/${f.id}/images`, { site: 'portal', as: w.tester }))).toHaveLength(1);
    const otherTester = await makeUser('tester', '別產品測試者', [w.productB.id]);
    expect((await pub(otherTester)).status).toBe(404);
    expect((await pub(w.outsider)).status).toBe(404);
    expect((await getBytes(`/public/products/${w.productA.slug}/feedback/${f.id}/images/${ids[0]}/original`, { site: 'portal' })).status).toBe(401);
    // back to internal: the next read is refused (no cached copy is offered)
    cur = expectOk(await api.get(`${P()}/feedback/${f.id}`, { as: w.teamA }));
    expectOk(await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { visibility: 'internal', expectedRevision: cur.revision } }));
    expect((await pub()).status).toBe(404);
    // a removed member loses access at once
    expectOk(await api.patch(`${P()}/feedback/${f.id}`, { as: w.teamA, body: { visibility: 'public', expectedRevision: cur.revision + 1 } }));
    expect((await pub()).status).toBe(200);
    await getSql()`delete from product_access where user_id = ${w.tester.id} and product_id = ${w.productA.id}`;
    expect((await pub()).status).toBe(404);
  });

  it('there is no static or guessable path: files live outside public/ and pending images have no read route', async () => {
    const pending = expectOk(await uploadImage(w.teamA, w.productA.id, await png()), 201);
    expect(fs.existsSync(path.join(process.cwd(), 'public', 'feedback-images'))).toBe(false);
    // a pending image is not attached to any feedback, so no feedback route can serve it
    const f = await createFeedback(w, { title: '沒有圖片' });
    expect((await getBytes(`${P()}/feedback/${f.id}/images/${pending.id}/original`, { as: w.teamA })).status).toBe(404);
  });
});

describe('IM06 file lifecycle', () => {
  it('removing a pending image deletes its files; only the uploader can remove it', async () => {
    const a = expectOk(await uploadImage(w.teamA, w.productA.id, await png()), 201);
    expect(files()).toHaveLength(2);
    expect((await api.del(`${P()}/feedback-images/${a.id}`, { as: w.teamB })).status).toBe(404);
    expectOk(await api.del(`${P()}/feedback-images/${a.id}`, { as: w.teamA }));
    await runJobs();
    expect(files()).toEqual([]);
  });

  it('attached images cannot be removed as pending; deleting the Feedback removes rows and files, and nothing of another Feedback', async () => {
    const one = await withImages(2);
    const two = await withImages(1);
    expect(files()).toHaveLength(6);
    expect((await api.del(`${P()}/feedback-images/${one.ids[0]}`, { as: w.teamA })).status).toBe(404);
    const cur = expectOk(await api.get(`${P()}/feedback/${one.f.id}`, { as: w.teamA }));
    expectOk(await api.del(`${P()}/feedback/${one.f.id}`, { as: w.teamA, ifMatch: cur.revision }));
    await runJobs();
    expect(files()).toHaveLength(2);
    expect(files().every((n) => n.startsWith(two.ids[0]))).toBe(true);
    expect((await getBytes(`${P()}/feedback/${two.f.id}/images/${two.ids[0]}/thumb`, { as: w.teamA })).status).toBe(200);
    expect((await getSql()`select 1 from feedback_images where id in ${getSql()(one.ids)}`).length).toBe(0);
  });

  it('pending images older than a day are removed when their uploader uploads again', async () => {
    const old = expectOk(await uploadImage(w.teamA, w.productA.id, await png()), 201);
    await getSql()`update feedback_images set created_at = now() - interval '25 hours' where id = ${old.id}`;
    expectOk(await uploadImage(w.teamA, w.productA.id, await png()), 201);
    await runJobs();
    expect((await getSql()`select 1 from feedback_images where id = ${old.id}`).length).toBe(0);
    expect(files().some((n) => n.startsWith(old.id))).toBe(false);
  });
});
