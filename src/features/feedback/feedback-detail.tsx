'use client';

import { useRef, type ReactNode } from 'react';
import { MoreHorizontalIcon, XIcon } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconTip } from '@/components/list-controls';
import { Markdown } from '@/components/markdown';

/**
 * The detail of a created Feedback (follow-up batch 2026-11-10, DETAIL-01/02/05, SCROLL-01/02), shared
 * by the admin pages (Feedback, Roadmap, Personal) and the portal. Built on the shared shadcn Dialog
 * (portal, overlay, focus trap, Escape, focus return). Three parts inside the visible height:
 *
 * 1. the detail (title, description, images, attributes) — its own scroll when very long, capped so
 *    the comments keep room; ⋯ and close sit outside it and are always reachable;
 * 2. the comment list — its own scroll (CommentThread);
 * 3. the composer — fixed at the bottom.
 *
 * The Feedback's author and creation time are not shown (they stay recorded on the server).
 */
export function DetailDialog({ title, onClose, menu, children, top, label }: {
  title: string; onClose: () => void; menu?: { label: string; danger?: boolean; onSelect: () => void }[];
  /** description, images and attributes, below the title */
  top?: ReactNode;
  /** the comment list and composer */
  children?: ReactNode;
  label?: string;
}) {
  const topRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* focus starts on the detail itself (not on ⋯ or close, which would pop their tooltips); Tab goes on from there */}
      <DialogContent showCloseButton={false} className="fd-dialog flex flex-col gap-0 p-0 sm:max-w-[min(894px,calc(100%-2rem))]"
        onOpenAutoFocus={(e) => { e.preventDefault(); topRef.current?.focus(); }}>
        <div className="fd-top-actions">
          {menu?.length ? (
            <DropdownMenu modal={false}>
              <IconTip label="更多操作">
                <DropdownMenuTrigger asChild>
                  <button type="button" className="fd-icon-btn fd-head-btn" aria-label="Feedback 更多操作"><MoreHorizontalIcon aria-hidden="true" /></button>
                </DropdownMenuTrigger>
              </IconTip>
              <DropdownMenuContent align="end" className="min-w-32">
                {menu.map((m) => <DropdownMenuItem key={m.label} variant={m.danger ? 'destructive' : 'default'} onSelect={m.onSelect}>{m.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <IconTip label="關閉">
            <DialogClose asChild>
              <button type="button" className="fd-icon-btn fd-head-btn" aria-label="關閉"><XIcon aria-hidden="true" /></button>
            </DialogClose>
          </IconTip>
        </div>
        <div ref={topRef} className="fd-top" tabIndex={-1}>
          <DialogTitle className="fd-title">{title}</DialogTitle>
          <DialogDescription className="sr-only">{label ?? 'Feedback 詳情與留言'}</DialogDescription>
          {top}
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** DETAIL-01: the description as written (basic Markdown, no raw HTML); nothing when empty. */
export function DetailDescription({ text }: { text: string }) {
  if (!text.trim()) return null;
  return <div className="fd-description"><Markdown text={text} /></div>;
}

/** DETAIL-01: the Feedback's images as thumbnails, each opening the original (access checked per read). */
export function DetailImages({ images, url }: { images: { id: string; width: number; height: number }[]; url: (id: string, v: 'thumb' | 'original') => string }) {
  if (!images.length) return null;
  return (
    <ul className="fd-images" aria-label={`圖片，共 ${images.length} 張`}>
      {images.map((img, i) => (
        <li key={img.id}>
          <a href={url(img.id, 'original')} target="_blank" rel="noopener noreferrer" aria-label={`開啟圖片 ${i + 1}（新分頁）`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url(img.id, 'thumb')} alt={`圖片 ${i + 1}`} loading="lazy" width={img.width} height={img.height} />
          </a>
        </li>
      ))}
    </ul>
  );
}
