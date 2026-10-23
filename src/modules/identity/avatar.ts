import sharp from 'sharp';
import type { Db } from '@/server/db';
import { AppError, invalid } from '@/server/errors';
import { randomToken } from '@/server/crypto';
import { getAvatarStorage } from '@/server/adapters/storage';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

function sniff(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

/** Validate real content (not the declared MIME), re-encode to WebP and strip metadata. */
export async function processAvatar(buf: Buffer): Promise<Buffer> {
  if (buf.length === 0) throw invalid('請選擇圖片。', { file: '檔案為空' });
  if (buf.length > AVATAR_MAX_BYTES) throw invalid('頭像最大 2 MB。', { file: '檔案超過 2 MB' });
  if (!sniff(buf)) throw invalid('只接受 JPEG、PNG 或 WebP。', { file: '不支援的格式' });
  try {
    return await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
  } catch {
    throw invalid('無法讀取圖片內容。', { file: '圖片損毀' });
  }
}

export async function uploadAvatar(db: Db, userId: string, buf: Buffer) {
  const data = await processAvatar(buf);
  const objectPath = `${userId}/${randomToken(12)}.webp`;
  try {
    await getAvatarStorage().put(objectPath, data, 'image/webp');
  } catch {
    throw new AppError('UPSTREAM_UNAVAILABLE', '頭像儲存服務暫時無法使用。');
  }
  const [u] = await db<{ revision: number }[]>`
    update users set avatar_path = ${objectPath}, revision = revision + 1, updated_at = now() where id = ${userId} returning revision
  `;
  return { revision: u.revision };
}
