import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FilesystemAvatarStorage, StorageError } from '@/server/adapters/storage';

const USER = '0b9e1c2a-4d5f-4a6b-8c7d-9e0f1a2b3c4d';
const OBJECT = `${USER}/AbCdEf0123456789.webp`;
const dirs: string[] = [];
function tempDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-fs-avatars-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function listAll(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((p) => p.split(path.sep).join('/')).sort();
}

describe('WIN-02 filesystem avatar storage', () => {
  it('stores under the fixed root and survives a restart (a new instance on the same root)', async () => {
    const root = tempDir();
    await new FilesystemAvatarStorage(root).put(OBJECT, Buffer.from('image-1'));
    expect(listAll(root)).toEqual([USER, `${USER}/AbCdEf0123456789.webp`]);
    const restarted = new FilesystemAvatarStorage(root);
    expect((await restarted.get(OBJECT))?.data.toString()).toBe('image-1');
    expect((await restarted.get(OBJECT))?.contentType).toBe('image/webp');
    expect(await restarted.get(`${USER}/ZZZZZZZZZZZZZZZZ.webp`)).toBeNull();
  });

  it('accepts only the generated object path shape: traversal and Windows special names are refused', async () => {
    const parent = tempDir();
    const root = path.join(parent, 'root');
    fs.mkdirSync(root);
    const storage = new FilesystemAvatarStorage(root);
    const bad = [
      '../escape.webp', `${USER}/../../escape.webp`, `${USER}\\..\\..\\escape.webp`, `../${USER}/AbCdEf0123456789.webp`,
      `/${USER}/AbCdEf0123456789.webp`, `C:\\${USER}\\AbCdEf0123456789.webp`, `${USER}/AbCdEf0123456789.webp:stream`,
      `${USER}/CON`, `${USER}/NUL.webp`, `${USER}/AbCdEf0123456789.webp.`, `${USER}/AbCdEf0123456789.webp `,
      `${USER.toUpperCase()}/AbCdEf0123456789.webp`, `${USER}/AbCdEf0123456789.png`, `${USER}/sub/AbCdEf0123456789.webp`,
      `${USER}/AbCdEf01234567%2F.webp`, '', USER,
    ];
    for (const p of bad) {
      await expect(storage.put(p, Buffer.from('x')), p).rejects.toMatchObject({ code: 'invalid_object_path' });
      await expect(storage.get(p), p).rejects.toBeInstanceOf(StorageError);
    }
    // nothing was written inside or next to the root
    expect(listAll(parent)).toEqual(['root']);
  });

  it('fails visibly when the root is missing instead of creating it somewhere else', async () => {
    const root = path.join(tempDir(), 'not-created');
    const storage = new FilesystemAvatarStorage(root);
    await expect(storage.put(OBJECT, Buffer.from('x'))).rejects.toMatchObject({ code: 'storage_root_unavailable' });
    await expect(storage.get(OBJECT)).rejects.toMatchObject({ code: 'storage_root_unavailable' });
    expect(fs.existsSync(root)).toBe(false);
  });

  it('refuses a user directory that is a link or junction to somewhere else', async () => {
    const root = tempDir();
    const outside = tempDir();
    fs.writeFileSync(path.join(outside, 'AbCdEf0123456789.webp'), 'outside');
    // a directory junction needs no special privilege on Windows
    fs.symlinkSync(outside, path.join(root, USER), process.platform === 'win32' ? 'junction' : 'dir');
    const storage = new FilesystemAvatarStorage(root);
    await expect(storage.get(OBJECT)).rejects.toMatchObject({ code: 'storage_link_refused' });
    await expect(storage.put(OBJECT, Buffer.from('x'))).rejects.toMatchObject({ code: 'storage_link_refused' });
    expect(fs.readFileSync(path.join(outside, 'AbCdEf0123456789.webp'), 'utf8')).toBe('outside');
  });

  it('writes atomically: no temporary file remains, and a failed write leaves no partial image', async () => {
    const root = tempDir();
    const storage = new FilesystemAvatarStorage(root);
    await storage.put(OBJECT, Buffer.alloc(300_000, 7));
    expect(listAll(root)).toEqual([USER, `${USER}/AbCdEf0123456789.webp`]);
    // the final name is occupied by a directory, so the rename step fails
    const other = `${USER}/Blocked000000000.webp`;
    fs.mkdirSync(path.join(root, USER, 'Blocked000000000.webp'));
    await expect(storage.put(other, Buffer.from('partial?'))).rejects.toThrow();
    expect(listAll(root)).toEqual([USER, `${USER}/AbCdEf0123456789.webp`, `${USER}/Blocked000000000.webp`]);
    expect(fs.readdirSync(path.join(root, USER, 'Blocked000000000.webp'))).toEqual([]);
    expect((await storage.get(OBJECT))?.data.length).toBe(300_000);
  });

  it('a reader polling a new object during its write sees nothing or the complete image', async () => {
    // uploads always use a new random name, so readers race only against the first write
    const root = tempDir();
    const storage = new FilesystemAvatarStorage(root);
    const data = Buffer.alloc(1_900_000, 3);
    const write = storage.put(OBJECT, data);
    const seen: (number | null)[] = [];
    let done = false;
    void write.finally(() => { done = true; });
    while (!done) seen.push((await storage.get(OBJECT).catch(() => null))?.data.length ?? null);
    await write;
    seen.push((await storage.get(OBJECT))?.data.length ?? null);
    expect(seen.every((n) => n === null || n === data.length)).toBe(true);
    expect(seen.at(-1)).toBe(data.length);
  });
});
