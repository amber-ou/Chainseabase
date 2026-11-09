'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, errorMessage } from '@/client/api';
import { useDebounced, useResource } from '@/client/hooks';
import { relativeTime, PRIORITY_LABEL } from '@/client/format';
import { Avatar, Button, ErrorState, LoadingState, Spinner } from '@/components/ui';
import { CheckChoices, FilterPopover, FilterSection, QuietEmpty, RadioChoices, SearchBox } from '@/components/list-controls';
import { IconGlobe, IconPlus } from '@/components/icons';
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
  // search and filters live in the URL: Back from another page or a reload keeps them, and a switch to
  // another product (another path) starts clean instead of reusing this product's category or tag ids
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [categoryId, setCategoryId] = useState(() => params.get('category') ?? '');
  const [tagIds, setTagIds] = useState<string[]>(() => params.getAll('tag'));
  const debouncedQ = useDebounced(q, 300);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const wanted = debouncedQ.trim();
    if (wanted) sp.set('q', wanted); else sp.delete('q');
    if (categoryId) sp.set('category', categoryId); else sp.delete('category');
    sp.delete('tag');
    for (const t of tagIds) sp.append('tag', t);
    const next = sp.toString();
    if (next !== window.location.search.replace(/^\?/, '')) router.replace(`${pathname}${next ? `?${next}` : ''}`, { scroll: false });
  }, [debouncedQ, categoryId, tagIds, pathname, router]);
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
  const [moreError, setMoreError] = useState<string | null>(null);
  useEffect(() => { setExtra([]); setMoreError(null); setCursor(list.meta.nextCursor ?? null); }, [list.data, list.meta.nextCursor]);

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
    setMoreError(null);
    try {
      const r = await api.get<Feedback[]>(`/products/${product.id}/feedback?${query}&cursor=${encodeURIComponent(cursor)}`);
      setExtra((e) => [...e, ...r.data]);
      setCursor(r.meta.nextCursor ?? null);
    } catch (e) {
      // what is already listed stays; the same button retries from the same place
      setMoreError(`${errorMessage(e)}已載入的項目不受影響，可再按一次「載入更多」。`);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Feedback</h1>
        </div>
      </div>
      {/* F01/F06/F09: one toolbar on the page background; create on the left, Filter and search on the right */}
      <div className="list-toolbar">
        <Button variant="primary" onClick={() => setCreating(true)} disabled={!tax.data}><IconPlus />新增 Feedback</Button>
        <div className="list-toolbar-end" role="search" aria-label="搜尋與篩選 Feedback">
          {list.refreshing ? <Spinner label="更新中" /> : null}
          <FilterPopover active={Boolean(categoryId || tagIds.length)} onClear={() => { setCategoryId(''); setTagIds([]); }}>
            <FilterSection title="類別">
              <RadioChoices name="fb-category" allLabel="全部類別" value={categoryId} onChange={setCategoryId}
                options={tax.data?.categories.map((c) => ({ id: c.id, label: c.name })) ?? []} />
            </FilterSection>
            <FilterSection title="標籤">
              <CheckChoices value={tagIds} onChange={setTagIds} options={tax.data ? tagOptions(tax.data).map((o) => ({ id: o.id, label: o.label, group: o.group })) : []} emptyLabel="這個產品尚無標籤" />
            </FilterSection>
          </FilterPopover>
          <SearchBox id="fb-search" label="搜尋 Feedback" value={q} onChange={setQ} className="list-toolbar-search" />
        </div>
      </div>

      {tax.error ? <ErrorState message={tax.error.message} onRetry={tax.reload} /> : null}
      {list.loading || tax.loading ? <LoadingState /> : list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : items.length === 0 ? (
        // F07: grey text only; "no results" (with search or filters) and "nothing yet" read differently
        <QuietEmpty>{debouncedQ || categoryId || tagIds.length ? '沒有符合目前搜尋或篩選條件的 Feedback，可調整關鍵字或清除篩選。' : '這個產品還沒有 Feedback。'}</QuietEmpty>
      ) : (
        <GroupedList items={items} tax={tax.data!} counts={list.meta.statusCounts ?? {}} onOpen={openItem} />
      )}
      {cursor && items.length > 0 ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          {moreError ? <div className="banner banner-error" role="alert">{moreError}</div> : null}
          <Button onClick={loadMore} pending={loadingMore}>載入更多</Button>
        </div>
      ) : null}

      {creating && tax.data ? (
        <FeedbackModal mode="create" taxonomy={tax.data} onClose={() => setCreating(false)} onChanged={() => void list.reload()} onTaxonomyChanged={() => void tax.reload()} />
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
