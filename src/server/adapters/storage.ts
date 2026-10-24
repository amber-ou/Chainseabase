import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../config';

export interface AvatarStorage {
  readonly mode: 'real' | 'fake';
  put(objectPath: string, data: Buffer, contentType: string): Promise<void>;
  get(objectPath: string): Promise<{ data: Buffer; contentType: string } | null>;
}

/** Supabase Storage via REST with the server-only service role key (bucket stays private). */
export class SupabaseAvatarStorage implements AvatarStorage {
  readonly mode = 'real' as const;
  constructor(private url: string, private key: string, private bucket: string) {}
  async put(objectPath: string, data: Buffer, contentType: string) {
    const res = await fetch(`${this.url}/storage/v1/object/${this.bucket}/${objectPath}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, apikey: this.key, 'content-type': contentType, 'x-upsert': 'true' },
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`storage_put_${res.status}`);
  }
  async get(objectPath: string) {
    const res = await fetch(`${this.url}/storage/v1/object/${this.bucket}/${objectPath}`, {
      headers: { authorization: `Bearer ${this.key}`, apikey: this.key },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`storage_get_${res.status}`);
    return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'image/webp' };
  }
}

/** Local development/test storage under .data/ (git-ignored). Not allowed in production. */
export class LocalAvatarStorage implements AvatarStorage {
  readonly mode = 'fake' as const;
  constructor(private root = path.join(process.cwd(), '.data', 'avatars')) {}
  async put(objectPath: string, data: Buffer) {
    const file = path.join(this.root, objectPath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }
  async get(objectPath: string) {
    try {
      return { data: await readFile(path.join(this.root, objectPath)), contentType: 'image/webp' };
    } catch {
      return null;
    }
  }
}

const g = globalThis as unknown as { __csbStorage?: AvatarStorage };

export function getAvatarStorage(): AvatarStorage {
  if (!g.__csbStorage) {
    const cfg = getConfig();
    g.__csbStorage = cfg.storageProvider === 'real' && cfg.supabaseUrl && cfg.supabaseServiceRoleKey
      ? new SupabaseAvatarStorage(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, cfg.supabaseAvatarBucket)
      : new LocalAvatarStorage();
  }
  return g.__csbStorage;
}

export function setAvatarStorage(s: AvatarStorage | undefined) {
  g.__csbStorage = s;
}
