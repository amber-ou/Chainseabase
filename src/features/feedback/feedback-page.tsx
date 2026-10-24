'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/client/api';
import { useDebounced, useResource } from '@/client/hooks';
import { relativeTime, PRIORITY_LABEL } from '@/client/format';
import { Avatar, Button, EmptyState, ErrorState, LoadingState, Spinner } from '@/components/ui';
import { MultiSelect } from '@/components/multiselect';
import { IconGlobe, IconPlus, IconSearch } from '@/components/icons';
import { useProduct } from '@/features/admin/shell';
import { FeedbackModal } from './feedback-modal';
import { tagOptions, type Feedback, type Taxonomy } from './types';

export function FeedbackPage() {
  const { product } = useProduct();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const item = params.get('item');
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const debouncedQ = useDebounced(q, 300);
  const tax = useResource<Taxonomy>(`/products/${product.id}/taxonomy`);
  const query = useMemo(() => {
    const sp = new URLSearchParams({ limit: '50' });
    if (debouncedQ.trim()) sp.set('q', debouncedQ.trim());
    if (categoryId) sp.set('categoryId', categoryId);
    for (const t of tagIds) sp.append('tagIds', t);
    return sp.toString();
  }, [debouncedQ, categoryId, tagIds]);
  const list = useResource<Feedback[]>(`/products/${product.id}/feedback?${query}`);
  const [extra, setExtra] = useState<Feedback[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => { setExtra([]); setCursor(list.meta.nextCursor ?? null); }, [list.data, list.meta.nextCursor]);

  const openItem = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set('item', id);
    else sp.delete('item');
    router.push(`${pathname}${sp.toString() ? `?${sp}` : ''}`, { scroll: false });
  };

  const items = [...(list.data ?? []), ...extra];
  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await api.get<Feedback[]>(`/products/${product.id}/feedback?${query}&cursor=${encodeURIComponent(cursor)}`);
      setExtra((e) => [...e, ...r.data]);
      setCursor(r.meta.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Feedback</h1>
          <p className="sub">哪些需求需要處理？依狀態分類，搜尋目前產品的標題與描述。</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)} disabled={!tax.data}><IconPlus />新增 Feedback</Button>
      </div>
      <div className="toolbar" role="search">
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
          <label htmlFor="fb-search" className="sr-only">搜尋 Feedback</label>
          <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--muted)' }}><IconSearch /></span>
          <input id="fb-search" className="input" style={{ paddingLeft: 32 }} placeholder="搜尋標題或描述…" maxLength={200} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="sr-only" htmlFor="fb-category">類別</label>
        <select id="fb-category" className="select" style={{ width: 180 }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">全部類別</option>
          {tax.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ width: 240 }}>
          {tax.data ? <MultiSelect label="篩選標籤" options={tagOptions(tax.data).map((o) => ({ ...o, single: false }))} value={tagIds} onChange={setTagIds} placeholder="篩選標籤" /> : null}
        </div>
        {list.refreshing ? <Spinner label="更新中" /> : null}
        <span className="muted small num" aria-live="polite">{list.data ? `共 ${list.meta.total ?? 0} 筆` : ''}</span>
      </div>

      {tax.error ? <ErrorState message={tax.error.message} onRetry={tax.reload} /> : null}
      {list.loading || tax.loading ? <LoadingState /> : list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <EmptyState
          title={debouncedQ || categoryId || tagIds.length ? '沒有符合條件的 Feedback' : '這個產品還沒有 Feedback'}
          action={debouncedQ || categoryId || tagIds.length ? <Button size="sm" onClick={() => { setQ(''); setCategoryId(''); setTagIds([]); }}>清除篩選</Button> : <Button size="sm" variant="primary" onClick={() => setCreating(true)}>新增第一筆</Button>}
        />
      ) : (
        <GroupedList items={items} tax={tax.data!} counts={list.meta.statusCounts ?? {}} onOpen={openItem} />
      )}
      {cursor && items.length > 0 ? <div style={{ marginTop: 12 }}><Button onClick={loadMore} pending={loadingMore}>載入更多</Button></div> : null}

      {creating && tax.data ? (
        <FeedbackModal mode="create" taxonomy={tax.data} onClose={() => setCreating(false)} onChanged={() => void list.reload()} />
      ) : null}
      {item && tax.data ? (
        <FeedbackModal mode="edit" feedbackId={item} taxonomy={tax.data} onClose={() => openItem(null)} onChanged={() => void list.reload()} />
      ) : null}
    </>
  );
}

function GroupedList({ items, tax, counts, onOpen }: { items: Feedback[]; tax: Taxonomy; counts: Record<string, number>; onOpen: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {tax.statuses.map((s) => {
        const rows = items.filter((f) => f.status.id === s.id);
        if (rows.length === 0 && !counts[s.id]) return null;
        return (
          <section key={s.id} className="list" aria-label={`${s.name} 的 Feedback`}>
            <div className="list-group-head"><span>{s.name}</span><span className="muted num small">{counts[s.id] ?? rows.length}</span></div>
            {rows.map((f) => (
              <button key={f.id} type="button" className="list-row" onClick={() => onOpen(f.id)}>
                <span className="title">{f.title}</span>
                <span className="meta">
                  {f.visibility === 'public' ? <span className="chip chip-outline" title="公開"><IconGlobe size={12} />公開</span> : null}
                  <span className="chip">{f.category.name}</span>
                  {f.version ? <span className="chip"><span className="chip-group">版本：</span>{f.version.name}</span> : null}
                  <span className="chip">{PRIORITY_LABEL[f.priority].split(' ')[0]}</span>
                  {f.personTags.length ? <span className="chip">{f.personTags.map((p) => p.name).join('、')}</span> : null}
                  <span className="num">留言 {f.commentCount}</span>
                  <Avatar name={f.author.displayName} url={f.author.avatarUrl} id={f.author.id} size={20} />
                  <span>{relativeTime(f.createdAt)}</span>
                </span>
              </button>
            ))}
            {rows.length === 0 ? <div className="list-row muted" style={{ cursor: 'default' }}>此狀態的項目尚未載入，請載入更多。</div> : null}
          </section>
        );
      })}
    </div>
  );
}

export function isConflict(e: unknown) {
  return e instanceof ApiError && e.status === 409;
}
