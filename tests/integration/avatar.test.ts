import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { handleApiRequest } from '@/server/api';
import { FilesystemAvatarStorage, LocalAvatarStorage, setAvatarStorage } from '@/server/adapters/storage';
import { getSql } from '@/server/db';
import { ADMIN, installFakes, makeUser, resetDb, type TestUser } from '../helpers/harness';

let u: TestUser;
beforeAll(() => { installFakes(); });
beforeEach(async () => {
  await resetDb();
  u = await makeUser('team', 'Avatar');
});

async function upload(body: Buffer, type: string) {
  return handleApiRequest(new Request(`${ADMIN}/api/v1/me/avatar-upload`, {
    method: 'POST', body: new Uint8Array(body),
    headers: { host: new URL(ADMIN).host, origin: ADMIN, cookie: `csb_session=${u.admin}`, 'content-type': type },
  }));
}

describe('avatar upload (account feature, not a Feedback attachment)', () => {
  it('re-encodes a real image to 256px WebP without metadata and serves it', async () => {
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#336699' } }).png().withMetadata({ exif: { IFD0: { Copyright: 'secret-gps' } } }).toBuffer();
    const r = await upload(png, 'image/png');
    expect(r.status).toBe(200);
    const body = await r.json();
    const img = await handleApiRequest(new Request(`${ADMIN}${body.data.avatarUrl}`, { headers: { host: new URL(ADMIN).host, cookie: `csb_session=${u.admin}` } }));
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    const out = Buffer.from(await img.arrayBuffer());
    const meta = await sharp(out).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 256, 256]);
    expect(meta.exif).toBeUndefined();
  });

  it('rejects SVG, spoofed types, empty and oversized files', async () => {
    expect((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).status).toBe(400);
    expect((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png')).status).toBe(400);
    expect((await upload(Buffer.alloc(0), 'image/png')).status).toBe(400);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024 + 10)]);
    expect((await upload(big, 'image/jpeg')).status).toBe(400);
  });
});

describe('WIN-02 avatars on the filesystem backend', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-win02-'));
    setAvatarStorage(new FilesystemAvatarStorage(root));
  });
  afterEach(() => {
    setAvatarStorage(new LocalAvatarStorage(path.join(os.tmpdir(), `csb-avatars-${process.pid}`)));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const png = () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#aa3311' } }).png().toBuffer();
  const get = (url: string) => handleApiRequest(new Request(`${ADMIN}${url}`, { headers: { host: new URL(ADMIN).host, cookie: `csb_session=${u.admin}` } }));
  const avatarPath = async () => (await getSql()<{ avatarPath: string | null }[]>`select avatar_path from users where id = ${u.id}`)[0].avatarPath;

  it('stores the processed image at the database path under the root and serves it after a restart', async () => {
    const r = await upload(await png(), 'image/png');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.storage).toBe('real');
    const stored = await avatarPath();
    expect(stored).toMatch(new RegExp(`^${u.id}/[A-Za-z0-9_-]{16}\\.webp$`));
    const file = path.join(root, ...stored!.split('/'));
    expect((await sharp(fs.readFileSync(file)).metadata()).format).toBe('webp');
    // a restarted server is a new storage instance on the same root
    setAvatarStorage(new FilesystemAvatarStorage(root));
    const img = await get(body.data.avatarUrl);
    expect(img.status).toBe(200);
    expect(Buffer.from(await img.arrayBuffer()).equals(fs.readFileSync(file))).toBe(true);
  });

  it('an unavailable root fails the upload with 503 and keeps the previous avatar', async () => {
    expect((await upload(await png(), 'image/png')).status).toBe(200);
    const before = await avatarPath();
    setAvatarStorage(new FilesystemAvatarStorage(path.join(root, 'missing')));
    const r = await upload(await png(), 'image/png');
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(await avatarPath()).toBe(before);
    expect((await get(`/api/v1/avatars/${u.id}`)).status).toBe(503);
  });

  it('a tampered database path is never used to read outside the root', async () => {
    fs.writeFileSync(path.join(path.dirname(root), 'csb-outside.webp'), 'outside');
    await getSql()`update users set avatar_path = ${'../csb-outside.webp'} where id = ${u.id}`;
    expect((await get(`/api/v1/avatars/${u.id}`)).status).toBe(404);
    fs.rmSync(path.join(path.dirname(root), 'csb-outside.webp'));
  });

  it('a streamed body over 2 MB is cut off without a content-length (no unbounded buffering)', async () => {
    let sent = 0;
    const chunk = new Uint8Array(256 * 1024);
    chunk.set([0xff, 0xd8, 0xff]);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 64 * 1024 * 1024) { controller.close(); return; }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const r = await handleApiRequest(new Request(`${ADMIN}/api/v1/me/avatar-upload`, {
      method: 'POST', body: stream, duplex: 'half',
      headers: { host: new URL(ADMIN).host, origin: ADMIN, cookie: `csb_session=${u.admin}`, 'content-type': 'image/jpeg' },
    } as RequestInit));
    expect(r.status).toBe(400);
    expect((await r.json()).error.fieldErrors.file).toBe('檔案超過 2 MB');
    // stopped after the limit, far below the 64 MB the client offered
    expect(sent).toBeLessThanOrEqual(2 * 1024 * 1024 + 2 * chunk.byteLength);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
