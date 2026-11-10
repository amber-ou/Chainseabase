'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpIcon, ChevronDownIcon, ChevronUpIcon, ImageIcon, LoaderCircleIcon, MoreHorizontalIcon, ReplyIcon, ThumbsUpIcon, XIcon } from 'lucide-react';
import { api, errorMessage } from '@/client/api';
import { useSite } from '@/client/site';
import { formatDateTime } from '@/client/format';
import { Avatar, ErrorState, LoadingState, useAnnouncer } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { IconTip } from '@/components/list-controls';
import { IMAGE_TYPES, MAX_IMAGES, useImageUploads } from './image-uploads';
import { ImagePreviews } from './image-previews';
import type { CommentItem } from './types';

/**
 * Comments of a Feedback detail (follow-up batch 2026-11-10, COMMENT-01..07 and SCROLL-03..05), in the
 * layout of the 「Feedback 詳情與留言」 reference mapped to Chainseabase tokens. Renders two parts for the
 * detail dialog: the list (its own vertical scroll, edge fades and arrows) and the composer fixed at
 * the bottom. Everything shown is real data; every action is the existing API with its permissions:
 *
 * - admin: like, quote reply, edit and remove any comment; images on new comments (team only).
 * - portal: like and quote reply as an invited member, edit own comments; no remove and no image
 *   upload (testers were never given either); images already on public comments are shown.
 */
export interface CommentEndpoints {
  list: string;
  create: string | null;
  like: (id: string) => string;
  edit: (id: string) => string;
  remove: ((id: string) => string) | null;
  canEdit: (c: CommentItem) => boolean;
  /** where a comment image is read (each read checks the Feedback's current access) */
  image: (commentId: string, imageId: string, variant: 'thumb' | 'original') => string;
  /** pending comment images (COMMENT-05); absent where uploading is not allowed */
  upload?: { path: string; remove: (id: string) => string };
}

export function adminCommentEndpoints(productId: string, feedbackId: string): CommentEndpoints {
  return {
    list: `/products/${productId}/feedback/${feedbackId}/comments`,
    create: `/products/${productId}/feedback/${feedbackId}/comments`,
    like: (id) => `/products/${productId}/comments/${id}/like`,
    edit: (id) => `/products/${productId}/comments/${id}`,
    remove: (id) => `/products/${productId}/comments/${id}`,
    canEdit: () => true,
    image: (c, i, v) => `/api/v1/products/${productId}/comments/${c}/images/${i}/${v}`,
    upload: { path: `/products/${productId}/comment-images`, remove: (id) => `/products/${productId}/comment-images/${id}` },
  };
}

const PAGE = 50;

/** Vertical overflow of a scroller: whether content is hidden above or below (SCROLL-03/04). */
function useScrollEdges(ref: React.RefObject<HTMLElement | null>) {
  const [edges, setEdges] = useState({ up: false, down: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const up = el.scrollTop > 1;
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((e) => (e.up === up && e.down === down ? e : { up, down }));
  }, [ref]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    // new comments, images that finish loading and size changes all move the edges
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    const mo = new MutationObserver(() => { for (const child of el.children) ro.observe(child); measure(); });
    mo.observe(el, { childList: true, subtree: true });
    el.addEventListener('scroll', measure, { passive: true });
    el.addEventListener('load', measure, true);
    return () => { ro.disconnect(); mo.disconnect(); el.removeEventListener('scroll', measure); el.removeEventListener('load', measure, true); };
  }, [ref, measure]);
  const by = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ top: dir * Math.max(80, el.clientHeight * 0.8), behavior: reduce ? 'auto' : 'smooth' });
  };
  return { edges, by, measure };
}

export function CommentThread({ feedbackId, isPublic, endpoints: ep, canInteract = true, onLoginRequired, total, onCountChanged, notice }: {
  feedbackId: string; isPublic: boolean; endpoints: CommentEndpoints; canInteract?: boolean; onLoginRequired?: () => void;
  /** the Feedback's real comment count (not the number loaded so far) */
  total: number;
  /** a comment was added or removed: the owner reloads the real count */
  onCountChanged?: () => void;
  /** a line above the composer (e.g. why the viewer cannot comment) */
  notice?: React.ReactNode;
}) {
  const { me } = useSite();
  const { announce, region } = useAnnouncer();
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string; revision: number } | null>(null);
  const [removing, setRemoving] = useState<CommentItem | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scroll = useScrollEdges(listRef);
  const headingId = useId();

  const load = useCallback(async (after: string | null) => {
    const r = await api.get<CommentItem[]>(`${ep.list}?limit=${PAGE}${after ? `&cursor=${encodeURIComponent(after)}` : ''}`);
    return { data: r.data, next: (r.meta?.nextCursor as string | null | undefined) ?? null };
  }, [ep.list]);
  // how many are shown, so a reload brings back at least the pages already loaded
  const shown = useRef(0);
  useEffect(() => { shown.current = items?.length ?? 0; }, [items]);
  /** Reload what is shown (at least the pages already loaded), keeping the scroll position. */
  const reload = useCallback(async () => {
    try {
      let all: CommentItem[] = [];
      let next: string | null = null;
      const want = Math.max(shown.current, 1);
      do {
        const page = await load(next);
        all = [...all, ...page.data];
        next = page.next;
      } while (next && all.length < want);
      setItems(all);
      setCursor(next);
      setLoadError(null);
    } catch (e) { setLoadError(errorMessage(e)); }
  }, [load]);
  useEffect(() => {
    let alive = true;
    load(null).then((p) => { if (alive) { setItems(p.data); setCursor(p.next); } }, (e) => { if (alive) setLoadError(errorMessage(e)); });
    return () => { alive = false; };
  }, [load]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const p = await load(cursor);
      setItems((list) => [...(list ?? []), ...p.data]);
      setCursor(p.next);
    } catch (e) { setError(errorMessage(e)); } finally { setLoadingMore(false); }
  };

  const toggleLike = async (c: CommentItem) => {
    if (!canInteract) { onLoginRequired?.(); return; }
    try {
      const r = c.likedByMe ? await api.del<{ liked: boolean; likeCount: number }>(ep.like(c.id)) : await api.put<{ liked: boolean; likeCount: number }>(ep.like(c.id));
      setItems((list) => list?.map((x) => (x.id === c.id ? { ...x, likedByMe: r.data.liked, likeCount: r.data.likeCount } : x)) ?? list);
    } catch (e) { setError(errorMessage(e)); }
  };
  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.body.trim()) { setError('留言不可空白'); return; }
    try {
      await api.patch(ep.edit(editing.id), { body: { body: editing.body, expectedRevision: editing.revision } });
      setEditing(null);
      await reload();
    } catch (e) { setError(errorMessage(e)); }
  };

  const list = items ?? [];
  return (
    <>
      {region}
      <section className="fd-comments" aria-labelledby={headingId}>
        <div className="fd-comments-head">
          <h3 id={headingId}>留言</h3>
          <span className="fd-count num" aria-label={`共 ${total} 則留言`}>{total}</span>
        </div>
        <div className="fd-comments-frame">
          <div ref={listRef} className="fd-comment-list" tabIndex={list.length ? 0 : -1} role="region" aria-label="留言列表，可上下捲動">
            {items === null && !loadError ? <LoadingState /> : loadError ? <ErrorState message={loadError} onRetry={() => void reload()} /> : list.length === 0 ? (
              <p className="fd-empty">還沒有留言。</p>
            ) : (
              <>
                {list.map((c) => (
                  <CommentRow key={c.id} c={c} ep={ep} canInteract={canInteract} canEdit={Boolean(me && canInteract && ep.canEdit(c))} canRemove={Boolean(me && ep.remove)}
                    onLike={() => void toggleLike(c)}
                    onReply={ep.create ? () => { if (!canInteract) { onLoginRequired?.(); return; } setReplyTo(c); composerRef.current?.focus(); } : undefined}
                    onEdit={() => setEditing({ id: c.id, body: c.body, revision: c.revision })} onRemove={() => setRemoving(c)}
                    editing={editing?.id === c.id ? editing : null} setEditing={setEditing} onSaveEdit={() => void saveEdit()} />
                ))}
                {cursor ? (
                  <div className="fd-more"><Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? '載入中…' : '載入更多留言'}</Button></div>
                ) : null}
              </>
            )}
          </div>
          {/* SCROLL-03/04: fades and arrows only where more comments are hidden; they never catch input */}
          <span className="fd-fade fd-fade-top" data-on={scroll.edges.up || undefined} aria-hidden="true" />
          <span className="fd-fade fd-fade-bottom" data-on={scroll.edges.down || undefined} aria-hidden="true" />
          {scroll.edges.up ? <button type="button" className="fd-scroll-btn fd-scroll-up" aria-label="向上捲動留言" onClick={() => scroll.by(-1)}><ChevronUpIcon aria-hidden="true" /></button> : null}
          {scroll.edges.down ? <button type="button" className="fd-scroll-btn fd-scroll-down" aria-label="向下捲動留言" onClick={() => scroll.by(1)}><ChevronDownIcon aria-hidden="true" /></button> : null}
        </div>
      </section>
      {ep.create ? (
        <Composer feedbackId={feedbackId} ep={ep} isPublic={isPublic} canInteract={canInteract} onLoginRequired={onLoginRequired} notice={notice}
          replyTo={replyTo} onCancelReply={() => setReplyTo(null)} inputRef={composerRef} error={error} setError={setError}
          onSent={async () => {
            setReplyTo(null);
            await reload();
            onCountChanged?.();
            announce('已送出留言');
            // the new comment is the last one: show it
            requestAnimationFrame(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; });
          }} />
      ) : null}
      <AlertDialog open={Boolean(removing)} onOpenChange={(o) => { if (!o) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除這則留言？</AlertDialogTitle>
            <AlertDialogDescription>移除後一般列表不再顯示，留言附加的圖片也會刪除；回覆它的留言會顯示「原留言已移除」。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button variant="destructive" onClick={async () => {
              if (!removing || !ep.remove) return;
              try {
                await api.del(ep.remove(removing.id), { ifMatch: removing.revision });
                setRemoving(null);
                await reload();
                onCountChanged?.();
              } catch (e) { setError(errorMessage(e)); setRemoving(null); }
            }}>移除留言</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CommentRow({ c, ep, canInteract, canEdit, canRemove, onLike, onReply, onEdit, onRemove, editing, setEditing, onSaveEdit }: {
  c: CommentItem; ep: CommentEndpoints; canInteract: boolean; canEdit: boolean; canRemove: boolean;
  onLike: () => void; onReply?: () => void; onEdit: () => void; onRemove: () => void;
  editing: { id: string; body: string; revision: number } | null; setEditing: (e: { id: string; body: string; revision: number } | null) => void; onSaveEdit: () => void;
}) {
  const editId = useId();
  return (
    <article className="fd-msg" aria-label={`${c.author.displayName} 的留言`}>
      <Avatar name={c.author.displayName} url={c.author.avatarUrl} id={c.author.id} size={28} />
      <div className="fd-msg-main">
        <div className="fd-msg-name">{c.author.displayName}{c.editedAt ? <span className="fd-edited">（已編輯）</span> : null}</div>
        {c.replyTo ? <div className="fd-quote">@{c.replyTo.author}：{c.replyTo.removed ? '原留言已移除' : c.replyTo.excerpt}</div> : null}
        {editing ? (
          <div className="fd-edit">
            <label className="sr-only" htmlFor={editId}>編輯留言</label>
            <textarea id={editId} className="fd-edit-input" maxLength={5000} value={editing.body} autoFocus onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSaveEdit(); } if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }} />
            <div className="fd-edit-actions">
              <Button size="sm" variant="cancel" onClick={() => setEditing(null)}>取消</Button>
              <Button size="sm" onClick={onSaveEdit}>儲存</Button>
            </div>
          </div>
        ) : (
          // COMMENT-02: the time sits right next to the bubble, centred on it; neither is squeezed away
          <div className="fd-msg-row">
            <div className="fd-bubble">
              <p>{c.body}</p>
              {c.images.length ? (
                <ul className="fd-msg-images" aria-label={`留言圖片，共 ${c.images.length} 張`}>
                  {c.images.map((img, i) => (
                    <li key={img.id}>
                      <a href={ep.image(c.id, img.id, 'original')} target="_blank" rel="noopener noreferrer" aria-label={`開啟留言圖片 ${i + 1}（新分頁）`}>
                        {/* served by the API with an access check on every read */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ep.image(c.id, img.id, 'thumb')} alt={`留言圖片 ${i + 1}`} loading="lazy" width={img.width} height={img.height} />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <time className="fd-time" dateTime={c.createdAt}>{formatDateTime(c.createdAt)}</time>
          </div>
        )}
      </div>
      {/* COMMENT-03: one like style for every comment: no fill, outline icon, solid and accent when liked */}
      <div className="fd-msg-actions" role="group" aria-label={`${c.author.displayName} 的留言操作`}>
        <button type="button" className="fd-like" aria-pressed={c.likedByMe} aria-label={`${c.likedByMe ? '收回讚' : '按讚'}，目前 ${c.likeCount} 個讚`} onClick={onLike}>
          <ThumbsUpIcon aria-hidden="true" fill={c.likedByMe ? 'currentColor' : 'none'} /><span className="num">{c.likeCount}</span>
        </button>
        {onReply ? (
          <IconTip label="回覆">
            <button type="button" className="fd-icon-btn" aria-label={`回覆 ${c.author.displayName}`} onClick={onReply}><ReplyIcon aria-hidden="true" /></button>
          </IconTip>
        ) : null}
        {(canEdit || canRemove) && canInteract && !editing ? (
          <DropdownMenu modal={false}>
            <IconTip label="更多操作">
              <DropdownMenuTrigger asChild>
                <button type="button" className="fd-icon-btn" aria-label={`${c.author.displayName} 的留言：更多操作`}><MoreHorizontalIcon aria-hidden="true" /></button>
              </DropdownMenuTrigger>
            </IconTip>
            <DropdownMenuContent align="end" className="min-w-32">
              {canEdit ? <DropdownMenuItem onSelect={onEdit}>編輯</DropdownMenuItem> : null}
              {canRemove ? <DropdownMenuItem variant="destructive" onSelect={onRemove}>移除</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </article>
  );
}

/** COMMENT-04/05, SCROLL-05: the composer fixed at the bottom of the dialog. */
function Composer({ feedbackId, ep, isPublic, canInteract, onLoginRequired, notice, replyTo, onCancelReply, inputRef, error, setError, onSent }: {
  feedbackId: string; ep: CommentEndpoints; isPublic: boolean; canInteract: boolean; onLoginRequired?: () => void; notice?: React.ReactNode;
  replyTo: CommentItem | null; onCancelReply: () => void; inputRef: React.RefObject<HTMLTextAreaElement | null>;
  error: string | null; setError: (e: string | null) => void; onSent: () => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = `new-comment-${feedbackId}`;
  const images = useImageUploads({ uploadPath: ep.upload?.path ?? '', deletePath: ep.upload?.remove ?? (() => '') });
  // the pending uploads are deleted when the detail closes without sending them
  const discard = useRef(images.discard);
  useEffect(() => { discard.current = images.discard; });
  useEffect(() => () => discard.current(), []);

  const empty = !body.trim();
  const blocked = empty || pending || images.uploading;
  const send = async () => {
    if (!canInteract) { onLoginRequired?.(); return; }
    if (empty) { setError('留言不可空白'); return; }
    if (images.uploading) { setError('圖片仍在上傳，完成後即可送出。'); return; }
    if (images.failed) { setError('有圖片上傳失敗，請重試或移除後再送出。'); return; }
    if (pending) return; // no double send
    setPending(true);
    setError(null);
    try {
      await api.post(ep.create!, { body: { body, replyToId: replyTo?.id ?? null, ...(images.ids.length ? { imageIds: images.ids } : {}) } });
      setBody('');
      images.clear();
      await onSent();
    } catch (e) {
      // the text and the images stay, so it can be sent again
      setError(`${errorMessage(e)}（留言內容與圖片都保留，可再送出）`);
    } finally { setPending(false); }
  };

  return (
    <div className="fd-composer">
      {notice ?? (isPublic
        ? <p className="fd-note">此留言會顯示在前台網站，受邀的 tester 也看得到，請勿留下內部資訊。</p>
        : <p className="fd-note">此 Feedback 為內部內容，留言僅團隊可見。</p>)}
      {replyTo ? (
        <div className="fd-replying">
          <span className="fd-replying-text">回覆 @{replyTo.author.displayName}：{replyTo.body.slice(0, 80)}</span>
          <button type="button" className="fd-icon-btn" aria-label="取消回覆" onClick={onCancelReply}><XIcon aria-hidden="true" /></button>
        </div>
      ) : null}
      <div className="fd-input-box">
        <label className="sr-only" htmlFor={inputId}>新增留言</label>
        <textarea ref={inputRef} id={inputId} className="fd-input" rows={2} maxLength={5000} value={body}
          placeholder={canInteract ? '留下你的想法…' : '登入並受邀後才能留言'} aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(e) => { setBody(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }} />
        {ep.upload ? (
          <div className="fd-input-previews">
            <ImagePreviews uploads={images.uploads} note={images.note} onRetry={images.retry} onRemove={images.remove} label="留言圖片" size="sm" />
          </div>
        ) : null}
        <div className="fd-input-bar">
          {ep.upload ? (
            <>
              <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden onChange={(e) => { images.addFiles(e.target.files); e.target.value = ''; }} />
              <IconTip label="加入圖片">
                <button type="button" className="fd-image-btn" aria-label={`加入圖片（JPEG、PNG、WebP，每張 5 MB 內，最多 ${MAX_IMAGES} 張）`} aria-disabled={images.full || !canInteract || undefined}
                  onClick={() => { if (!canInteract) { onLoginRequired?.(); return; } if (images.full) images.setNote(`每則留言最多 ${MAX_IMAGES} 張圖片。`); else fileRef.current?.click(); }}>
                  <ImageIcon aria-hidden="true" />
                </button>
              </IconTip>
            </>
          ) : null}
          <IconTip label="送出留言（Ctrl／⌘ + Enter）">
            <button type="button" className="fd-send" aria-label="送出留言" aria-disabled={blocked || undefined} aria-busy={pending || undefined} onClick={() => void send()}>
              {pending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <ArrowUpIcon aria-hidden="true" />}
            </button>
          </IconTip>
        </div>
      </div>
      {error ? <p id={`${inputId}-error`} className="fd-error" role="alert">{error}</p> : null}
    </div>
  );
}
