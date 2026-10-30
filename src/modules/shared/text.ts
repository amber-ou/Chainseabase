import { z } from 'zod';

/** Unicode code point length (not UTF-16 units). */
export function charLength(s: string): number {
  return [...s].length;
}

/** Trimmed string validated by Unicode character count. */
export function text(min: number, max: number, label: string) {
  return z
    .string({ error: `${label}必須是文字` })
    .transform((s) => s.trim())
    .refine((s) => charLength(s) >= min, { message: min === 1 ? `${label}不可空白` : `${label}至少 ${min} 字` })
    .refine((s) => charLength(s) <= max, { message: `${label}最多 ${max} 字` });
}

export const zUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '識別碼格式錯誤').transform((s) => s.toLowerCase());

export const zRevision = z.number({ error: '缺少版本資訊' }).int().min(0);

/** Escape LIKE wildcards for parameterized ILIKE search. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

/** Opaque cursor for (created_at DESC, id DESC) pagination. */
export function encodeCursor(createdAt: Date | string, id: string): string {
  return Buffer.from(JSON.stringify([iso(createdAt), id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined | null): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof createdAt !== 'string' || typeof id !== 'string' || Number.isNaN(Date.parse(createdAt))) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export const zLimit = z.coerce.number().int().min(1).max(100).default(50);
