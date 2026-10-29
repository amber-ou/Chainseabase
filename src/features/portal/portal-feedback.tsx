'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { api, ApiError, errorMessage, newKey } from '@/client/api';
import { useDebounced, useResource } from '@/client/hooks';
import { loginHref, useSite } from '@/client/site';
import { formatDateTime, relativeTime } from '@/client/format';
import { Avatar, Button, EmptyState, ErrorState, Field, LoadingState } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Markdown } from '@/components/markdown';
import { IconPlus, IconSearch, IconUp } from '@/components/icons';
import { useToast } from '@/components/toast';
import { CommentThread, type CommentEndpoints } from '@/features/feedback/comments';
import { usePortalProduct } from './portal-shell';

export interface PublicFeedback {
  id: string; title: string; description: string; status: { id: string; name: string }; author: { id: string; displayName: string; avatarUrl: string | null };
  createdAt: string; voteCount: number; commentCount: number; myVote: boolean; canEdit: boolean; revision: number;
}

export function PortalFeedbackPage() {
  const { product } = usePortalProduct();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const item = params.get('item');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [creating, setCreating] = useState(false);
  const list = useResource<PublicFeedback[]>(`/public/products/${product.slug}/feedback?limit=50${dq.trim() ? `&q=${encodeURIComponent(dq.trim())}` : ''}`);
  const loginPath = loginHref(`${pathname}${item ? `?item=${item}` : ''}`);
  const requireInteraction = () => {
    if (!product.viewer.loggedIn) window.location.assign(loginPath);
  };
  const open = (id: string | null) => router.push(id ? `${pathname}?item=${id}` : pathname, { scroll: false });
  return (
    <>
      <div className="page-head">
        <div><h1>Feedback</h1><p className="sub">受邀成員可見的需求與回饋；可以新增、投票與留言。</p></div>
        <Button variant="primary" onClick={() => (product.viewer.canInteract ? setCreating(true) : requireInteraction())}
          aria-describedby={!product.viewer.canInteract ? 'create-hint' : undefined}><IconPlus />新增回饋</Button>
      </div>
      {!product.viewer.canInteract ? <p id="create-hint" className="small muted" style={{ marginTop: -12, marginBottom: 12 }}>{product.viewer.loggedIn ? '你尚未受邀參與此產品，無法新增或互動。' : '登入並受邀後才能新增、投票與留言。'}</p> : null}
      <div className="toolbar" role="search">
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
          <label className="sr-only" htmlFor="pq">搜尋公開回饋</label>
          <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--muted)' }}><IconSearch /></span>
          <input id="pq" className="input" style={{ paddingLeft: 32 }} maxLength={200} placeholder="搜尋標題或描述…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="small muted num">{list.data ? `共 ${list.meta.total ?? 0} 筆` : ''}</span>
      </div>
      {list.loading ? <LoadingState /> : list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : (list.data ?? []).length === 0 ? (
        <EmptyState title={dq ? '沒有符合的公開回饋' : '還沒有公開回饋'} />
      ) : (
        <div className="list">
          {(list.data ?? []).map((f) => (
            <div key={f.id} className="portal-row">
              <VoteButton productId={product.id} feedback={f} canInteract={product.viewer.canInteract} onRequire={requireInteraction} onChanged={() => void list.reload()} />
              <div className="portal-row-main">
                <button type="button" className="portal-row-title" onClick={() => open(f.id)}>{f.title}</button>
                <span className="meta"><span className="chip">{f.status.name}</span><span className="num">留言 {f.commentCount}</span><Avatar name={f.author.displayName} url={f.author.avatarUrl} id={f.author.id} size={20} /><span>{f.author.displayName}</span><span>{relativeTime(f.createdAt)}</span></span>
              </div>
            </div>
          ))}
        </div>
      )}
      {creating ? <CreatePortalFeedback productId={product.id} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void list.reload(); open(id); }} /> : null}
      {item ? <PortalFeedbackModal id={item} onClose={() => open(null)} onChanged={() => void list.reload()} onRequire={requireInteraction} /> : null}
    </>
  );
}

function VoteButton({ productId, feedback, canInteract, onRequire, onChanged }: { productId: string; feedback: PublicFeedback; canInteract: boolean; onRequire: () => void; onChanged: (v: { voted: boolean; voteCount: number }) => void }) {
  const [state, setState] = useState({ voted: feedback.myVote, count: feedback.voteCount });
  const [pending, setPending] = useState(false);
  return (
    // aria-disabled (not disabled) while pending: a disabled button would drop keyboard focus
    <button type="button" className="vote-btn" aria-pressed={state.voted} aria-disabled={pending || undefined} aria-label={`${state.voted ? '收回投票' : '投票'}，目前 ${state.count} 票`}
      onClick={async () => {
        if (pending) return;
        if (!canInteract) { onRequire(); return; }
        setPending(true);
        try {
          const r = state.voted ? await api.del(`/portal/products/${productId}/feedback/${feedback.id}/vote`) : await api.put(`/portal/products/${productId}/feedback/${feedback.id}/vote`);
          setState({ voted: r.data.voted, count: r.data.voteCount });
          onChanged(r.data);
        } finally { setPending(false); }
      }}>
      <IconUp size={14} /><span className="num small">{state.count}</span>
    </button>
  );
}

function CreatePortalFeedback({ productId, onClose, onCreated }: { productId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const key = useRef<string | null>(null);
  return (
    <Modal title="新增回饋" onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" pending={pending} onClick={async () => {
      if (!title.trim()) { setErrors({ title: '標題不可空白' }); return; }
      key.current ??= newKey();
      setPending(true);
      setErrors({});
      try {
        const r = await api.post(`/portal/products/${productId}/feedback`, { key: key.current, body: { title, description } });
        toast('success', '已送出回饋，受邀成員可以看到');
        onCreated(r.data.id);
      } catch (e) {
        setErrors(e instanceof ApiError ? { ...e.body.fieldErrors, _: e.message } : { _: errorMessage(e) });
      } finally { setPending(false); }
    }}>送出</Button></>}>
      {errors._ ? <div className="banner banner-error" role="alert">{errors._}（內容已保留）</div> : null}
      <p className="small muted">送出後顯示給此產品的受邀成員。分類與處理狀態由團隊管理。</p>
      <Field label="標題" required error={errors.title}>{(p) => <input {...p} className="input" maxLength={200} value={title} onChange={(e) => { key.current = null; setTitle(e.target.value); }} data-autofocus />}</Field>
      <Field label="描述" hint="支援基本 Markdown（段落、清單、粗體、連結）" error={errors.description}>{(p) => <textarea {...p} className="textarea" rows={6} maxLength={20000} value={description} onChange={(e) => { key.current = null; setDescription(e.target.value); }} />}</Field>
    </Modal>
  );
}

function PortalFeedbackModal({ id, onClose, onChanged, onRequire }: { id: string; onClose: () => void; onChanged: () => void; onRequire: () => void }) {
  const { product } = usePortalProduct();
  const { me } = useSite();
  const res = useResource<PublicFeedback>(`/public/products/${product.slug}/feedback/${id}`);
  const [editing, setEditing] = useState<{ title: string; description: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (res.loading) return <Modal title="Feedback" onClose={onClose}><LoadingState /></Modal>;
  if (res.error || !res.data) return <Modal title="Feedback" onClose={onClose}><ErrorState title="找不到內容" message="此回饋不存在、已改為內部或已移除。" /></Modal>;
  const f = res.data;
  const endpoints: CommentEndpoints = {
    list: `/public/products/${product.slug}/feedback/${f.id}/comments`,
    create: `/portal/products/${product.id}/feedback/${f.id}/comments`,
    like: (cid) => `/portal/products/${product.id}/comments/${cid}/like`,
    edit: (cid) => `/portal/products/${product.id}/comments/${cid}`,
    remove: null,
    canEdit: (c) => product.viewer.canInteract && c.author.id === me?.id,
  };
  return (
    <Modal wide title={f.title} onClose={onClose}>
      <div className="fb-author">
        <Avatar name={f.author.displayName} url={f.author.avatarUrl} id={f.author.id} size={28} />
        <span>{f.author.displayName}</span><span className="small">· {formatDateTime(f.createdAt)}</span>
        <span className="chip">{f.status.name}</span>
        <span style={{ marginLeft: 'auto' }}><VoteButton productId={product.id} feedback={f} canInteract={product.viewer.canInteract} onRequire={onRequire} onChanged={onChanged} /></span>
      </div>
      {error ? <div className="banner banner-error" role="alert">{error}</div> : null}
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="標題">{(p) => <input {...p} className="input" maxLength={200} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />}</Field>
          <Field label="描述">{(p) => <textarea {...p} className="textarea" rows={6} maxLength={20000} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />}</Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" onClick={async () => {
              try {
                await api.patch(`/portal/products/${product.id}/feedback/${f.id}`, { body: { ...editing, expectedRevision: f.revision } });
                setEditing(null);
                await res.reload();
                onChanged();
              } catch (e) { setError(e instanceof ApiError && e.status === 409 ? '內容已被更新，請重新整理後再編輯。' : errorMessage(e)); }
            }}>儲存</Button>
            <Button onClick={() => setEditing(null)}>取消</Button>
          </div>
        </div>
      ) : (
        <>
          <Markdown text={f.description} />
          {f.canEdit ? <div><Button size="sm" onClick={() => setEditing({ title: f.title, description: f.description })}>編輯內容</Button></div> : null}
        </>
      )}
      <section aria-label="留言">
        <h3 style={{ marginBottom: 8 }}>留言</h3>
        {!product.viewer.canInteract ? <p className="small muted" style={{ marginBottom: 8 }}>{product.viewer.loggedIn ? '你尚未受邀參與此產品，只能閱讀留言。' : <>需要 <a href={loginHref(`/p/${product.slug}/feedback?item=${f.id}`)}>登入</a> 並受邀後才能留言。</>}</p> : null}
        <CommentThread productId={product.id} feedbackId={f.id} isPublic endpoints={endpoints} canInteract={product.viewer.canInteract} onLoginRequired={onRequire} />
      </section>
    </Modal>
  );
}
