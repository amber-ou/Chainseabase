'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/client/api';
import { useResource } from '@/client/hooks';
import { useSite } from '@/client/site';
import { relativeTime, formatDateTime } from '@/client/format';
import { Avatar, Button, ErrorState, LoadingState } from '@/components/ui';
import { ConfirmModal } from '@/components/modal';
import { IconGlobe, IconHeart, IconReply } from '@/components/icons';
import type { CommentItem } from './types';

export interface CommentEndpoints {
  list: string;
  create: string | null;
  like: (id: string) => string;
  edit: (id: string) => string;
  remove: ((id: string) => string) | null;
  canEdit: (c: CommentItem) => boolean;
}

export function adminCommentEndpoints(productId: string, feedbackId: string): CommentEndpoints {
  return {
    list: `/products/${productId}/feedback/${feedbackId}/comments`,
    create: `/products/${productId}/feedback/${feedbackId}/comments`,
    like: (id) => `/products/${productId}/comments/${id}/like`,
    edit: (id) => `/products/${productId}/comments/${id}`,
    remove: (id) => `/products/${productId}/comments/${id}`,
    canEdit: () => true,
  };
}

/** General (non-Schedule) comment stream with quote replies and likes. */
export function CommentThread({ productId, feedbackId, isPublic, endpoints, canInteract = true, onLoginRequired }: {
  productId: string; feedbackId: string; isPublic: boolean; endpoints?: CommentEndpoints; canInteract?: boolean; onLoginRequired?: () => void;
}) {
  const ep = endpoints ?? adminCommentEndpoints(productId, feedbackId);
  const { me } = useSite();
  const list = useResource<CommentItem[]>(`${ep.list}?limit=100`);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string; revision: number } | null>(null);
  const [removing, setRemoving] = useState<CommentItem | null>(null);

  const send = async () => {
    if (!ep.create) return;
    if (!canInteract) { onLoginRequired?.(); return; }
    if (!body.trim()) { setError('留言不可空白'); return; }
    setPending(true);
    setError(null);
    try {
      await api.post(ep.create, { body: { body, replyToId: replyTo?.id ?? null } });
      setBody('');
      setReplyTo(null);
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };
  const toggleLike = async (c: CommentItem) => {
    if (!canInteract) { onLoginRequired?.(); return; }
    try {
      if (c.likedByMe) await api.del(ep.like(c.id));
      else await api.put(ep.like(c.id));
      await list.reload();
    } catch (e) { setError(errorMessage(e)); }
  };
  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api.patch(ep.edit(editing.id), { body: { body: editing.body, expectedRevision: editing.revision } });
      setEditing(null);
      await list.reload();
    } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <div>
      {list.loading ? <LoadingState /> : list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : (list.data ?? []).length === 0 ? (
        <p className="muted" style={{ marginBottom: 12 }}>還沒有留言。</p>
      ) : (
        <div style={{ marginBottom: 12 }}>
          {(list.data ?? []).map((c) => (
            <article key={c.id} className="comment" aria-label={`${c.author.displayName} 的留言`}>
              <Avatar name={c.author.displayName} url={c.author.avatarUrl} id={c.author.id} size={28} />
              <div className="comment-body">
                <div className="comment-head">
                  <strong>{c.author.displayName}</strong>
                  <time className="small muted" dateTime={c.createdAt} title={formatDateTime(c.createdAt)}>{relativeTime(c.createdAt)}</time>
                  {c.editedAt ? <span className="small muted">（已編輯）</span> : null}
                </div>
                {c.replyTo ? (
                  <div className="quote">@{c.replyTo.author}：{c.replyTo.removed ? '原留言已移除' : c.replyTo.excerpt}</div>
                ) : null}
                {editing?.id === c.id ? (
                  <div className="composer">
                    <label className="sr-only" htmlFor={`edit-${c.id}`}>編輯留言</label>
                    <textarea id={`edit-${c.id}`} className="textarea" maxLength={5000} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button size="sm" variant="primary" onClick={saveEdit}>儲存</Button>
                      <Button size="sm" onClick={() => setEditing(null)}>取消</Button>
                    </div>
                  </div>
                ) : <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.body}</p>}
                <div className="comment-actions">
                  <Button size="sm" variant="ghost" aria-pressed={c.likedByMe} aria-label={`${c.likedByMe ? '收回讚' : '按讚'}，目前 ${c.likeCount} 個讚`} onClick={() => toggleLike(c)}>
                    <IconHeart filled={c.likedByMe} />{c.likeCount}
                  </Button>
                  {ep.create ? <Button size="sm" variant="ghost" onClick={() => { if (!canInteract) { onLoginRequired?.(); return; } setReplyTo(c); }}><IconReply />回覆</Button> : null}
                  {me && ep.canEdit(c) ? <Button size="sm" variant="ghost" onClick={() => setEditing({ id: c.id, body: c.body, revision: c.revision })}>編輯</Button> : null}
                  {me && ep.remove ? <Button size="sm" variant="ghost" onClick={() => setRemoving(c)}>移除</Button> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {ep.create ? (
        <div className="composer">
          {isPublic ? <div className="banner banner-info small"><IconGlobe size={14} />此留言會公開顯示在前台網站。內部工作內容請使用 Schedule。</div> : <div className="small muted">此 Feedback 為內部內容，留言僅團隊可見。</div>}
          {replyTo ? <div className="quote" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>回覆 @{replyTo.author.displayName}：{replyTo.body.slice(0, 80)}</span><Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>取消回覆</Button></div> : null}
          <label className="sr-only" htmlFor={`new-comment-${feedbackId}`}>新增留言</label>
          <textarea id={`new-comment-${feedbackId}`} className="textarea" rows={3} maxLength={5000} placeholder={canInteract ? '寫下留言…' : '登入並受邀後才能留言'} value={body} onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }} />
          {error ? <div className="field-error" role="alert">{error}</div> : null}
          <div className="composer-foot">
            <span className="small muted">Ctrl/⌘ + Enter 送出</span>
            <Button variant="primary" size="sm" pending={pending} onClick={send}>送出留言</Button>
          </div>
        </div>
      ) : null}
      {removing && ep.remove ? (
        <ConfirmModal title="移除這則留言？" confirmLabel="移除留言" danger onCancel={() => setRemoving(null)} onConfirm={async () => {
          try {
            await api.del(ep.remove!(removing.id), { ifMatch: removing.revision });
            setRemoving(null);
            await list.reload();
          } catch (e) { setError(errorMessage(e)); setRemoving(null); }
        }}>
          移除後一般列表不再顯示；回覆它的留言會顯示「原留言已移除」。
        </ConfirmModal>
      ) : null}
    </div>
  );
}
