import sharp from 'sharp';
import type { Db } from '@/server/db';
import { AppError, invalid } from '@/server/errors';
import { enqueueJob } from '@/server/events';
import { getAvatarStorage, StorageError } from '@/server/adapters/storage';
import { logError } from '@/server/log';

/**
 * Feedback images (phase 2 UI/UX checklist IM01-IM06).
 *
 * - IM01: at most 5 per Feedback, 5 MB each, JPEG / PNG / WebP decided by the file's real content
 *   (magic bytes, then the decoder), not by the declared type or the name.
 * - IM05: stored in the existing private storage (local folder outside the app, or the private
 *   Supabase bucket); never served as static files. Metadata (EXIF, GPS) is removed by re-encoding in
 *   the same format, with the orientation applied; a WebP thumbnail is made next to it.
 * - IM02/IM06: an image is uploaded before its Feedback exists ("pending") and attached on creation.
 *   Pending images are only visible to and removable by their uploader, expire after a day, and
 *   every deleted row hands its two files to a retried 'storage.delete' job, after commit.
 * - IM04: reads go through readFeedbackImage, which checks the Feedback's current access each time.
 */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGES_PER_FEEDBACK = 5;
const PENDING_PER_USER = 20;
const PENDING_TTL_HOURS = 24;
const THUMB_SIZE = 320;

type Format = 'jpeg' | 'png' | 'webp';
const EXT: Record<Format, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const TYPE: Record<Format, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export interface ImageDto { id: string; width: number; height: number; contentType: string }

function sniff(buf: Buffer): Format | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

const tooLarge = () => invalid('每張圖片最大 5 MB。', { file: '檔案超過 5 MB' });

/** Read the upload body, stopping as soon as it exceeds IMAGE_MAX_BYTES. */
export async function readImageBody(req: Request): Promise<Buffer> {
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > IMAGE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Validate the real content and produce the stored image (same format, metadata removed) and its thumbnail. */
export async function processImage(buf: Buffer) {
  if (buf.length === 0) throw invalid('請選擇圖片。', { file: '檔案為空' });
  if (buf.length > IMAGE_MAX_BYTES) throw tooLarge();
  const format = sniff(buf);
  if (!format) throw invalid('只接受 JPEG、PNG 或 WebP。', { file: '不支援的格式' });
  try {
    const input = () => sharp(buf, { limitInputPixels: 40_000_000 }).rotate();
    const meta = await sharp(buf, { limitInputPixels: 40_000_000 }).metadata();
    if (meta.format !== format) throw new Error('format_mismatch');
    const encoded = format === 'jpeg' ? input().jpeg({ quality: 90, mozjpeg: true }) : format === 'png' ? input().png() : input().webp({ quality: 90 });
    const { data: original, info } = await encoded.toBuffer({ resolveWithObject: true });
    const thumb = await input().resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    // re-encoding a PNG can grow it; the stored file keeps the same limit as the upload
    if (original.length > IMAGE_MAX_BYTES) throw tooLarge();
    return { format, original, thumb, width: info.width, height: info.height };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw invalid('無法讀取圖片內容。', { file: '圖片損毀或格式不符' });
  }
}

/** Hand files to the delete job (runs after commit; a rolled-back transaction deletes nothing). */
async function deleteFilesLater(tx: Db, paths: string[]) {
  if (paths.length) await enqueueJob(tx, 'storage.delete', { paths });
}

/** Delete the given image rows and schedule their files. */
async function deleteRows(tx: Db, where: ReturnType<Db>) {
  const rows = await tx<{ originalPath: string; thumbPath: string }[]>`delete from feedback_images where ${where} returning original_path, thumb_path`;
  await deleteFilesLater(tx, rows.flatMap((r) => [r.originalPath, r.thumbPath]));
  return rows.length;
}

/** Store a pending image for the uploader (team member) in one product. */
export async function uploadPendingImage(db: Db, withTx: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>, userId: string, productId: string, buf: Buffer): Promise<ImageDto> {
  const img = await processImage(buf);
  const [{ id }] = await db<{ id: string }[]>`select gen_random_uuid() as id`;
  const originalPath = `feedback-images/${productId}/${id}-original.${EXT[img.format]}`;
  const thumbPath = `feedback-images/${productId}/${id}-thumb.webp`;
  const storage = getAvatarStorage();
  try {
    await storage.put(originalPath, img.original, TYPE[img.format]);
    await storage.put(thumbPath, img.thumb, 'image/webp');
  } catch (e) {
    logError('feedback_image_store_failed', e, { productId, backend: storage.backend });
    await Promise.allSettled([storage.remove(originalPath), storage.remove(thumbPath)]);
    throw new AppError('UPSTREAM_UNAVAILABLE', '圖片儲存服務暫時無法使用，請稍後重試。');
  }
  try {
    return await withTx(async (tx) => {
      // the uploader's expired pending images go first (cancelled dialogs, closed tabs)
      await deleteRows(tx, tx`uploader_id = ${userId} and feedback_id is null and created_at < now() - ${`${PENDING_TTL_HOURS} hours`}::interval`);
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int as n from feedback_images where uploader_id = ${userId} and feedback_id is null
      `;
      if (n >= PENDING_PER_USER) throw new AppError('INVALID_REQUEST', '尚未建立的圖片過多，請先建立或取消目前的 Feedback。', { fieldErrors: { file: '待建立的圖片過多' } });
      await tx`
        insert into feedback_images (id, product_id, uploader_id, content_type, original_path, thumb_path, byte_size, width, height)
        values (${id}, ${productId}, ${userId}, ${TYPE[img.format]}, ${originalPath}, ${thumbPath}, ${img.original.length}, ${img.width}, ${img.height})
      `;
      return { id, width: img.width, height: img.height, contentType: TYPE[img.format] };
    });
  } catch (e) {
    // no row refers to the files: remove them now (a failure here only leaves unreachable files)
    await Promise.allSettled([storage.remove(originalPath), storage.remove(thumbPath)]);
    throw e;
  }
}

/** The uploader removes one of their pending images (removed from the dialog, or the dialog was cancelled). */
export async function deletePendingImage(tx: Db, userId: string, productId: string, imageId: string) {
  const n = await deleteRows(tx, tx`id = ${imageId} and product_id = ${productId} and uploader_id = ${userId} and feedback_id is null`);
  if (n === 0) throw new AppError('NOT_FOUND');
}

/** Attach the actor's pending images to a new Feedback, in the given order (IM03). */
export async function attachImages(tx: Db, actorId: string, productId: string, feedbackId: string, imageIds: string[]) {
  if (imageIds.length === 0) return;
  const ids = [...new Set(imageIds)];
  if (ids.length !== imageIds.length) throw invalid('圖片重複。', { imageIds: '圖片重複' });
  if (ids.length > IMAGES_PER_FEEDBACK) throw invalid(`每筆 Feedback 最多 ${IMAGES_PER_FEEDBACK} 張圖片。`, { imageIds: `最多 ${IMAGES_PER_FEEDBACK} 張` });
  const rows = await tx<{ id: string }[]>`
    select id from feedback_images
    where id in ${tx(ids)} and product_id = ${productId} and uploader_id = ${actorId} and feedback_id is null
    for update
  `;
  if (rows.length !== ids.length) throw invalid('部分圖片已失效，請移除後重新上傳。', { imageIds: '圖片已失效' });
  for (const [position, id] of ids.entries()) {
    await tx`update feedback_images set feedback_id = ${feedbackId}, position = ${position}, attached_at = now() where id = ${id}`;
  }
}

export async function listFeedbackImages(db: Db, productId: string, feedbackId: string): Promise<ImageDto[]> {
  return db<ImageDto[]>`
    select i.id, i.width, i.height, i.content_type from feedback_images i
    join feedback f on f.id = i.feedback_id and f.product_id = i.product_id and f.deleted_at is null
    where i.product_id = ${productId} and i.feedback_id = ${feedbackId}
    order by i.position
  `;
}

/** Soft-deleted Feedback: its images (rows and files) are removed with it (IM06). */
export async function deleteImagesOfFeedback(tx: Db, feedbackId: string) {
  await deleteRows(tx, tx`feedback_id = ${feedbackId}`);
}

/** Product deletion: every image of the product, attached or pending (IM06). */
export async function deleteImagesOfProduct(tx: Db, productId: string) {
  await deleteRows(tx, tx`product_id = ${productId}`);
}

/**
 * One image file, after checking the Feedback's current access (IM04). `scope` is the caller's
 * already-verified reach: team (any live Feedback of the product) or public (only public Feedback).
 * Anything else answers 404, the same as an image that does not exist.
 */
export async function readFeedbackImage(db: Db, scope: 'team' | 'public', productId: string, feedbackId: string, imageId: string, variant: 'original' | 'thumb') {
  const [row] = await db<{ originalPath: string; thumbPath: string; contentType: string }[]>`
    select i.original_path, i.thumb_path, i.content_type from feedback_images i
    join feedback f on f.id = i.feedback_id and f.product_id = i.product_id
    where i.id = ${imageId} and i.feedback_id = ${feedbackId} and i.product_id = ${productId}
      and f.deleted_at is null ${scope === 'public' ? db`and f.visibility = 'public'` : db``}
  `;
  if (!row) throw new AppError('NOT_FOUND');
  const storage = getAvatarStorage();
  const objectPath = variant === 'thumb' ? row.thumbPath : row.originalPath;
  let obj: Awaited<ReturnType<typeof storage.get>>;
  try {
    obj = await storage.get(objectPath);
  } catch (e) {
    logError('feedback_image_read_failed', e, { imageId, backend: storage.backend });
    if (e instanceof StorageError && e.code === 'invalid_object_path') throw new AppError('NOT_FOUND');
    throw new AppError('UPSTREAM_UNAVAILABLE', '圖片儲存服務暫時無法使用。');
  }
  if (!obj) throw new AppError('NOT_FOUND');
  return { data: obj.data, contentType: variant === 'thumb' ? 'image/webp' : row.contentType };
}

/**
 * Headers for an image response: the browser may keep nothing (each view re-checks access, so a
 * Feedback made internal, deleted or a signed-out account stops showing it), and shared caches
 * (Tunnel, proxies) must never store it.
 */
export function imageHeaders(contentType: string) {
  return {
    'content-type': contentType,
    'cache-control': 'private, no-store, max-age=0',
    vary: 'Cookie',
    'x-content-type-options': 'nosniff',
    'content-disposition': 'inline',
    'cross-origin-resource-policy': 'same-origin',
  };
}

/** Outbox job: remove stored files of deleted rows. Missing files are fine; errors are retried. */
export async function runStorageDeleteJob(payload: Record<string, unknown>): Promise<'done' | 'retry'> {
  const paths = Array.isArray(payload.paths) ? payload.paths.filter((p): p is string => typeof p === 'string') : [];
  const storage = getAvatarStorage();
  const results = await Promise.allSettled(paths.map((p) => storage.remove(p)));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    logError('storage_delete_failed', (failed[0] as PromiseRejectedResult).reason, { count: failed.length, backend: storage.backend });
    return 'retry';
  }
  return 'done';
}
