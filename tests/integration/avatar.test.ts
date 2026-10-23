import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { handleApiRequest } from '@/server/api';
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
    const img = await handleApiRequest(new Request(`${ADMIN}${body.data.avatarUrl}`, { headers: { host: new URL(ADMIN).host } }));
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
