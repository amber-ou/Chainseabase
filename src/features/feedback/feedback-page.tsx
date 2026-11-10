'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, errorMessage } from '@/client/api';
import { useDebounced, useResource } from '@/client/hooks';
import { Button, ErrorState, LoadingState, useAnnouncer } from '@/components/ui';
import { CheckChoices, FilterPopover, FilterSection, QuietEmpty, RadioChoices, SearchBox } from '@/components/list-controls';
import { IconPlus } from '@/components/icons';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button as UiButton } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useProduct, PageTitle } from '@/features/admin/shell';
import { FeedbackModal } from './feedback-modal';
import { ViewTable, viewName, type FeedbackView } from './feedback-views';
import { tagOptions, type Taxonomy } from './types';

/**
 * Admin Feedback (2026-11-10, LIST-01..15): shared filter tables. Every table is a view (one status or
 * one tag) kept for the whole product team; the page's search and filter apply to all of them on top of
 * each view's own condition. 新增 Feedback and 新增篩選 on the left; the filter icon, a rule and the
 * search on the right (TOOL-01..04 unchanged). The portal Feedback list is not changed.
 */
export function FeedbackPage() {
  const { product } = useProduct();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const item = params.get('item');
  const { announce, region } = useAnnouncer();
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
    const sp = new URLSearchParams();
    if (debouncedQ.trim()) sp.set('q', debouncedQ.trim());
    if (categoryId) sp.set('categoryId', categoryId);
    for (const t of tagIds) sp.append('tagIds', t);
    return sp.toString();
  }, [debouncedQ, categoryId, tagIds]);
  const P = `/products/${product.id}`;
  const list = useResource<{ revision: number; views: FeedbackView[] }>(`${P}/feedback-views`);
  // LIST-07: any change (an attribute, a new or deleted Feedback, a move) reloads every table
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const [listError, setListError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<FeedbackView | null>(null);

  const openItem = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set('item', id);
    else sp.delete('item');
    router.push(`${pathname}${sp.toString() ? `?${sp}` : ''}`, { scroll: false });
  };

  /** A change to the set or order of views; a stale list revision reloads and says so (LIST-06). */
  const changeList = async (fn: (revision: number) => Promise<{ revision: number; views: FeedbackView[] }>, done?: string) => {
    if (!list.data) return;
    setListError(null);
    try {
      const r = await fn(list.data.revision);
      list.setData({ revision: r.revision, views: r.views });
      if (done) announce(done);
    } catch (e) {
      setListError(e instanceof ApiError && e.status === 409 ? '表格剛被其他成員調整，已載入最新的表格，請再操作一次。' : errorMessage(e));
      void list.reload();
    }
  };
  const addView = (kind: 'status' | 'tag', optionId: string) => changeList(
    async (rev) => (await api.post<{ revision: number; views: FeedbackView[] }>(`${P}/feedback-views`, { body: { kind, optionId, expectedRevision: rev } })).data,
    '已新增篩選表格',
  );
  const reorder = (ids: string[]) => changeList(
    async (rev) => (await api.put<{ revision: number; views: FeedbackView[] }>(`${P}/feedback-views/order`, { body: { viewIds: ids, expectedRevision: rev } })).data,
    '已調整表格順序',
  );
  const views = list.data?.views ?? [];
  const moveView = (i: number, dir: -1 | 1) => {
    const ids = views.map((v) => v.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void reorder(ids).then(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-view-grip="${views[i].id}"]`)?.focus()));
  };
  const dropView = (draggedId: string, targetId: string) => {
    const ids = views.map((v) => v.id).filter((id) => id !== draggedId);
    ids.splice(ids.indexOf(targetId), 0, draggedId);
    void reorder(ids);
  };
  const updateView = (patch: Partial<FeedbackView> & { id: string }) => {
    list.setData((d) => (d ? { ...d, views: d.views.map((v) => (v.id === patch.id ? { ...v, ...patch } : v)) } : d!));
  };

  const filtering = Boolean(debouncedQ.trim() || categoryId || tagIds.length);
  const usedStatus = new Set(views.filter((v) => v.kind === 'status').map((v) => v.optionId));
  const usedTag = new Set(views.filter((v) => v.kind === 'tag').map((v) => v.optionId));
  const allTags = tax.data ? [...tax.data.tagGroups.flatMap((g) => g.tags.map((t) => ({ id: t.id, label: t.name, group: g.name }))), ...tax.data.ungroupedTags.map((t) => ({ id: t.id, label: t.name, group: null as string | null }))] : [];

  return (
    <>
      {region}
      <div className="page-head">
        <div>
          <PageTitle><h1>Feedback</h1></PageTitle>
        </div>
      </div>
      {/* F01/F06/F09, LIST-05: create and 新增篩選 on the left; Filter, a rule and search on the right */}
      <div className="list-toolbar">
        <div className="list-toolbar-start">
          <Button variant="primary" onClick={() => setCreating(true)} disabled={!tax.data}><IconPlus />新增 Feedback</Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild disabled={!tax.data || !list.data}>
              <UiButton><IconPlus />新增篩選</UiButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-48">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">依一個狀態或一個標籤建立表格</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>狀態</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 min-w-44 overflow-y-auto">
                  {tax.data?.statuses.map((s) => (
                    <DropdownMenuItem key={s.id} disabled={usedStatus.has(s.id)} onSelect={() => void addView('status', s.id)}>
                      {s.name}{usedStatus.has(s.id) ? <span className="ml-auto text-xs text-muted-foreground">已有表格</span> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>標籤</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 min-w-52 overflow-y-auto">
                  {allTags.length === 0 ? <DropdownMenuItem disabled>這個產品尚無標籤</DropdownMenuItem> : allTags.map((t) => (
                    <DropdownMenuItem key={t.id} disabled={usedTag.has(t.id)} onSelect={() => void addView('tag', t.id)}>
                      <span className="min-w-0 truncate">{t.group ? <span className="text-muted-foreground">{t.group}：</span> : null}{t.label}</span>
                      {usedTag.has(t.id) ? <span className="ml-auto pl-2 text-xs text-muted-foreground">已有表格</span> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="list-toolbar-end" role="search" aria-label="搜尋與篩選 Feedback">
          <FilterPopover active={Boolean(categoryId || tagIds.length)} onClear={() => { setCategoryId(''); setTagIds([]); }}>
            <FilterSection title="類別">
              <RadioChoices name="fb-category" allLabel="全部類別" value={categoryId} onChange={setCategoryId}
                options={tax.data?.categories.map((c) => ({ id: c.id, label: c.name })) ?? []} />
            </FilterSection>
            <FilterSection title="標籤">
              <CheckChoices value={tagIds} onChange={setTagIds} options={tax.data ? tagOptions(tax.data).map((o) => ({ id: o.id, label: o.label, group: o.group })) : []} emptyLabel="這個產品尚無標籤" />
            </FilterSection>
          </FilterPopover>
          {/* TOOL-02: a thin rule between the filter and the search */}
          <span className="toolbar-sep" aria-hidden="true" />
          <SearchBox id="fb-search" label="搜尋 Feedback" value={q} onChange={setQ} className="list-toolbar-search" variant="toolbar" />
        </div>
      </div>
      {filtering ? <p className="small muted fbv-filter-note">搜尋與篩選套用於每個表格，並與表格本身的條件同時成立。</p> : null}
      {listError ? <div className="banner banner-error" role="alert" style={{ marginBottom: 12 }}>{listError}</div> : null}

      {tax.error ? <ErrorState message={tax.error.message} onRetry={tax.reload} /> : null}
      {list.loading || tax.loading ? <LoadingState /> : list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : views.length === 0 ? (
        <QuietEmpty>目前沒有篩選表格。可用「新增篩選」依狀態或標籤建立。</QuietEmpty>
      ) : (
        <div className="fbv-list">
          {views.map((v, i) => (
            <ViewTable key={v.id} productId={product.id} view={v} index={i} count={views.length} query={query} tax={tax.data!} refreshKey={refreshKey}
              onOpen={(id) => openItem(id)} onChanged={refresh} onTaxonomyChanged={() => void tax.reload()} announce={announce}
              onMoveView={(dir) => moveView(i, dir)} onDropView={(dragged) => dropView(dragged, v.id)} onRemove={() => setRemoving(v)}
              onViewChanged={updateView} />
          ))}
        </div>
      )}

      {/* LIST-08: removing a table removes only the view and its order */}
      <AlertDialog open={Boolean(removing)} onOpenChange={(o) => { if (!o) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除「{removing ? viewName(removing) : ''}」表格？</AlertDialogTitle>
            <AlertDialogDescription>只會移除這個篩選表格與它的排序，所有成員都不再看到它。不會刪除任何 Feedback，也不會改變 Feedback 的狀態或標籤；之後可再用「新增篩選」建立。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <UiButton variant="destructive" onClick={() => {
              const v = removing;
              setRemoving(null);
              if (v) void changeList(async (rev) => (await api.del<{ revision: number; views: FeedbackView[] }>(`${P}/feedback-views/${v.id}`, { ifMatch: rev })).data, `已移除「${viewName(v)}」表格`);
            }}>移除表格</UiButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {creating && tax.data ? (
        <FeedbackModal mode="create" taxonomy={tax.data} onClose={() => setCreating(false)} onChanged={refresh} onTaxonomyChanged={() => void tax.reload()} />
      ) : null}
      {item && tax.data ? (
        <FeedbackModal mode="edit" feedbackId={item} taxonomy={tax.data} onTaxonomyChanged={() => void tax.reload()} onClose={() => openItem(null)} onChanged={refresh} />
      ) : null}
    </>
  );
}
