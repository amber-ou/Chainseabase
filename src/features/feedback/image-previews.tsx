'use client';

import { LoaderCircleIcon, RotateCwIcon, XIcon } from 'lucide-react';
import type { Upload } from './image-uploads';

/**
 * Previews of chosen images with their state: uploading (spinner), failed (retry, and the reason
 * below), and a remove button on each. Shared by the Feedback form and the comment composer.
 */
export function ImagePreviews({ uploads, onRemove, onRetry, note, label = '已選圖片', size = 'md' }: {
  uploads: Upload[]; onRemove: (u: Upload) => void; onRetry: (u: Upload) => void; note?: string | null; label?: string; size?: 'md' | 'sm';
}) {
  if (!uploads.length && !note) return null;
  return (
    <>
      {uploads.length ? (
        <ul className="fbc-previews" data-size={size} aria-label={`${label}，共 ${uploads.length} 張`}>
          {uploads.map((u, i) => (
            <li key={u.key} className="fbc-preview" data-state={u.state}>
              {/* a local preview (object URL) or the stored thumbnail, served by the API with an access check */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u.preview} alt={`圖片 ${i + 1}：${u.name}`} />
              {u.state === 'uploading' ? <span className="fbc-preview-state" role="status"><LoaderCircleIcon className="animate-spin" aria-hidden="true" /><span className="sr-only">上傳中</span></span> : null}
              {u.state === 'error' ? (
                <span className="fbc-preview-state fbc-preview-error">
                  <button type="button" className="fbc-retry" onClick={() => onRetry(u)} aria-label={`重試上傳圖片 ${i + 1}`}><RotateCwIcon aria-hidden="true" /></button>
                </span>
              ) : null}
              <button type="button" className="fbc-preview-remove" onClick={() => onRemove(u)} aria-label={`移除圖片 ${i + 1}`}><XIcon aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      {uploads.filter((u) => u.state === 'error').map((u) => (
        <p key={u.key} className="fbc-image-error" role="alert">「{u.name}」上傳失敗：{u.error} 可重試或移除。</p>
      ))}
      {note ? <p className="fbc-image-error" role="alert">{note}</p> : null}
    </>
  );
}
