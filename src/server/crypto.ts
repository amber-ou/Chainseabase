import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getConfig } from './config';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hmacHex(key: string, input: string): string {
  return createHmac('sha256', key).update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Stable JSON for hashing request bodies (sorted keys). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function bodyHash(value: unknown): string {
  return sha256Hex(stableStringify(value ?? null));
}

// ---------------------------------------------------------------------------
// Token encryption (AES-256-GCM). Ciphertext format: v<version>.<iv>.<tag>.<data>
// Keys live only in the runtime secret store, never next to the ciphertext.
// ---------------------------------------------------------------------------

function parseKey(b64: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  return key;
}

function keyring(): { current: number; keys: Map<number, Buffer> } {
  const cfg = getConfig();
  if (!cfg.tokenEncryptionKey) throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  const keys = new Map<number, Buffer>();
  for (const part of cfg.tokenEncryptionPreviousKeys.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [v, k] = part.split(':');
    keys.set(Number(v), parseKey(k));
  }
  keys.set(cfg.tokenEncryptionKeyVersion, parseKey(cfg.tokenEncryptionKey));
  return { current: cfg.tokenEncryptionKeyVersion, keys };
}

export function isEncryptionConfigured(): boolean {
  return Boolean(getConfig().tokenEncryptionKey);
}

export function encryptSecret(plain: string): { ciphertext: string; keyVersion: number } {
  const { current, keys } = keyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.get(current)!, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `v${current}.${iv.toString('base64url')}.${tag.toString('base64url')}.${data.toString('base64url')}`,
    keyVersion: current,
  };
}

export function decryptSecret(ciphertext: string): string {
  const [v, iv, tag, data] = ciphertext.split('.');
  const version = Number(v.slice(1));
  const key = keyring().keys.get(version);
  if (!key) throw new Error(`No encryption key for version ${version}`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
