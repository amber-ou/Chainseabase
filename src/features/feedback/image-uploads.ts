'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, newKey } from '@/client/api';

/**
 * Picking, uploading, previewing and removing up to 5 images (JPEG / PNG / WebP, 5 MB each), shared by
 * the Feedback form (create and edit, IM01-IM06, DETAIL-03) and the comment composer (COMMENT-04/05).
 * The server checks the same limits on the real content; these checks only save a pointless upload.
 *
 * - A new file is uploaded at once as a "pending" image of this person; it is attached when the form or
 *   comment is sent. Removing it, or discarding the form, deletes the pending file on the server.
 * - `existing` images (edit mode) already belong to the Feedback: removing one here only leaves it out of
 *   the list that is saved; nothing is deleted until the edit is saved.
 * - A failed upload keeps its preview with retry and remove.
 */
export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface Upload {
  key: string;
  name: string;
  /** the chosen file; absent for an image that already belongs to the Feedback */
  file?: File;
  preview: string;
  state: 'uploading' | 'done' | 'error';
  serverId?: string;
  error?: string;
  existing?: boolean;
}

export function useImageUploads({ uploadPath, deletePath, initial = [], onChange }: {
  uploadPath: string;
  deletePath: (id: string) => string;
  initial?: { id: string; preview: string; name: string }[];
  /** called after any change of the list (e.g. to reset an idempotency key) */
  onChange?: () => void;
}) {
  const [uploads, setUploads] = useState<Upload[]>(() => initial.map((i) => ({ key: i.id, name: i.name, preview: i.preview, state: 'done', serverId: i.id, existing: true })));
  const [note, setNote] = useState<string | null>(null);
  const changed = useRef(onChange);
  useEffect(() => { changed.current = onChange; }, [onChange]);

  // object URLs of local previews are released with the component
  const uploadsRef = useRef(uploads);
  useEffect(() => { uploadsRef.current = uploads; }, [uploads]);
  useEffect(() => () => { for (const u of uploadsRef.current) if (u.file) URL.revokeObjectURL(u.preview); }, []);

  const upload = useCallback(async (key: string, file: File) => {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, state: 'uploading', error: undefined } : u)));
    try {
      const r = await api.post<{ id: string }>(uploadPath, { rawBody: file, headers: { 'content-type': file.type } });
      changed.current?.();
      setUploads((list) => list.map((u) => (u.key === key ? { ...u, state: 'done', serverId: r.data.id } : u)));
    } catch (e) {
      setUploads((list) => list.map((u) => (u.key === key ? { ...u, state: 'error', error: errorMessage(e) } : u)));
    }
  }, [uploadPath]);

  /** Returns how many files were accepted for upload. */
  const addFiles = (files: FileList | File[] | null) => {
    if (!files || !files.length) return 0;
    const notes: string[] = [];
    const room = MAX_IMAGES - uploadsRef.current.length;
    const picked = [...files];
    if (picked.length > room) notes.push(`最多 ${MAX_IMAGES} 張圖片，已略過 ${picked.length - Math.max(room, 0)} 張。`);
    const accepted: Upload[] = [];
    for (const file of picked.slice(0, Math.max(room, 0))) {
      if (!IMAGE_TYPES.includes(file.type)) { notes.push(`「${file.name}」不是 JPEG、PNG 或 WebP。`); continue; }
      if (file.size > MAX_IMAGE_BYTES) { notes.push(`「${file.name}」超過 5 MB。`); continue; }
      accepted.push({ key: newKey(), name: file.name, file, preview: URL.createObjectURL(file), state: 'uploading' });
    }
    setNote(notes.length ? notes.join(' ') : null);
    if (!accepted.length) return 0;
    setUploads((list) => [...list, ...accepted]);
    changed.current?.();
    for (const u of accepted) void upload(u.key, u.file!);
    return accepted.length;
  };

  const remove = (u: Upload) => {
    if (u.file) URL.revokeObjectURL(u.preview);
    setUploads((list) => list.filter((x) => x.key !== u.key));
    changed.current?.();
    // an uploaded pending file is deleted now; an unfinished upload expires by itself; an existing
    // image is only left out of the list that will be saved
    if (u.serverId && !u.existing) void api.del(deletePath(u.serverId)).catch(() => undefined);
  };

  const retry = (u: Upload) => { if (u.file) void upload(u.key, u.file); };

  /** Delete every pending upload (the form or comment was discarded). */
  const discard = () => {
    for (const u of uploadsRef.current) if (u.serverId && !u.existing) void api.del(deletePath(u.serverId)).catch(() => undefined);
  };

  /** Forget the list after it was sent (the images now belong to what was created). */
  const clear = () => {
    for (const u of uploadsRef.current) if (u.file) URL.revokeObjectURL(u.preview);
    setUploads([]);
    setNote(null);
  };

  return {
    uploads, note, setNote, addFiles, remove, retry, discard, clear,
    uploading: uploads.some((u) => u.state === 'uploading'),
    failed: uploads.some((u) => u.state === 'error'),
    ids: uploads.filter((u) => u.serverId).map((u) => u.serverId!),
    full: uploads.length >= MAX_IMAGES,
  };
}
