'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownIcon, ChevronDownIcon, GripVerticalIcon, MessageCircleIcon, MoreHorizontalIcon } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/client/api';
import { formatDateTime, relativeTime } from '@/client/format';
import { Button, ErrorState, LoadingState } from '@/components/ui';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconTip } from '@/components/list-controls';
import { AttributePills, attrsOf, createProductTag, PersonTagPill, useAttributeSaver } from './feedback-attributes';
import type { Feedback, Taxonomy } from './types';
import { cn } from 'cn';

/**
 * One shared Feedback view (2026-11-10, LIST-01..15): a collapsible filter table of the admin Feedback
 * list. Layout from the Feedback List reference (docs/design-references/feedback-list), mapped to
 * Chainseabase tokens; data, actions and permissions are the real ones:
 *
 * - Rows come from the server for this view (its status or tag, intersected with the page's search and
 *   filters), with the real total and paging. A view is not a container: the same Feedback can be in
 *   several views, and an edit anywhere reloads every view, so a row that no longer matches leaves.
 * - 分類 (category, tags, version, priority) and 負責人 (Person tag) are changed in place and saved at once.
 * - Rows move only within their own table (drag, or Alt+↑／↓ on the title); the view then keeps a
 *   manual order. 建立時間 returns it to creation time, newest first. Rows never move across tables.
 * - The header: drag handle (drag, or ↑／↓ while focused), name, count, then ⋯ (上移、下移、移除表格)
 *   and the collapse button, kept apart so dragging never collapses or removes.
 */
export interface FeedbackView {
  id: string; kind: 'status' | 'tag'; optionId: string; label: string; groupName: string | null;
  color: 'blue' | 'sand' | 'green' | 'lilac' | 'rose' | 'teal'; sortMode: 'created' | 'manual'; revision: number;
}

const PAGE = 50;
/** The row being dragged (HTML5 drag data cannot be read while dragging over a target). */
const dragging: { current: { viewId: string; feedbackId: string } | null } = { current: null };
export const viewDragging: { current: string | null } = { current: null };

export function viewName(v: FeedbackView) {
  return v.kind === 'tag' && v.groupName ? `${v.groupName}：${v.label}` : v.label;
}

/** The plain text of a description, for the one-line summary (the detail keeps the original). */
function summary(text: string) {
  return text.replace(/[`*_>#~]|\[([^\]]*)\]\([^)]*\)/g, (_, link) => link ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function readCollapsed(id: string) {
  try { return localStorage.getItem(`csb:fbview:${id}:collapsed`) === '1'; } catch { return false; }
}

export function ViewTable({ productId, view, index, count, query, tax, refreshKey, onOpen, onChanged, onTaxonomyChanged, onMoveView, onDropView, onRemove, onViewChanged, announce }: {
  productId: string; view: FeedbackView; index: number; count: number; query: string; tax: Taxonomy; refreshKey: number;
  onOpen: (id: string) => void; onChanged: () => void; onTaxonomyChanged: () => void;
  onMoveView: (dir: -1 | 1) => void; onDropView: (draggedId: string) => void; onRemove: () => void;
  /** the view's sort mode or revision changed (after a move or a sort) */
  onViewChanged: (v: Partial<FeedbackView> & { id: string }) => void;
  announce: (m: string) => void;
}) {
  const P = `/products/${productId}`;
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dropRow, setDropRow] = useState<string | 'end' | null>(null);
  const [dropView, setDropView] = useState(false);
  const shown = useRef(PAGE);
  useEffect(() => { setCollapsed(readCollapsed(view.id)); }, [view.id]);

  const load = useCallback(async (offset: string | null, limit = PAGE) => {
    const r = await api.get<Feedback[]>(`${P}/feedback-views/${view.id}/items?limit=${limit}&${query}${offset ? `&cursor=${offset}` : ''}`);
    return { data: r.data, total: (r.meta?.total as number) ?? 0, next: (r.meta?.nextCursor as string | null) ?? null };
  }, [P, view.id, query]);
  // (re)load what is shown: the first page, or as many rows as were loaded before (a reload keeps them)
  useEffect(() => {
    let alive = true;
    load(null, Math.min(Math.max(shown.current, PAGE), 100)).then((p) => {
      if (!alive) return;
      setItems(p.data); setTotal(p.total); setCursor(p.next); setError(null);
    }, (e) => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [load, refreshKey, view.sortMode]);
  useEffect(() => { shown.current = items?.length ?? PAGE; }, [items]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const p = await load(cursor);
      setItems((list) => [...(list ?? []), ...p.data]);
      setTotal(p.total); setCursor(p.next);
    } catch (e) { setActionError(`${errorMessage(e)}已載入的項目不受影響，可再按一次「載入更多」。`); } finally { setLoadingMore(false); }
  };

  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(`csb:fbview:${view.id}:collapsed`, c ? '0' : '1'); } catch { /* storage unavailable */ }
      return !c;
    });
  };

  /** LIST-10: put `feedbackId` before `beforeId` (null: last) in this view only. */
  const move = async (feedbackId: string, beforeId: string | null) => {
    setActionError(null);
    try {
      const r = await api.post<{ revision: number; sortMode: 'manual' }>(`${P}/feedback-views/${view.id}/move`, { body: { feedbackId, beforeId, expectedRevision: view.revision } });
      // the moved row shows at once where it was dropped; the server's order follows on reload
      setItems((list) => {
        if (!list) return list;
        const row = list.find((f) => f.id === feedbackId);
        if (!row) return list;
        const rest = list.filter((f) => f.id !== feedbackId);
        const at = beforeId ? rest.findIndex((f) => f.id === beforeId) : rest.length;
        rest.splice(at < 0 ? rest.length : at, 0, row);
        return rest;
      });
      onViewChanged({ id: view.id, revision: r.data.revision, sortMode: 'manual' });
      announce(`已調整「${viewName(view)}」的排序`);
    } catch (e) {
      setActionError(e instanceof ApiError && e.status === 409 ? '這個表格的排序剛被其他人調整，已重新載入，請再試一次。' : errorMessage(e));
      onChanged();
    }
  };
  /** LIST-11: back to creation time, newest first. */
  const sortByCreated = async () => {
    if (view.sortMode === 'created') return;
    setActionError(null);
    try {
      const r = await api.put<{ revision: number; sortMode: 'created' }>(`${P}/feedback-views/${view.id}/sort`, { body: { mode: 'created', expectedRevision: view.revision } });
      onViewChanged({ id: view.id, revision: r.data.revision, sortMode: 'created' });
      announce(`「${viewName(view)}」改為依建立時間排序，最新在上`);
    } catch (e) {
      setActionError(e instanceof ApiError && e.status === 409 ? '這個表格剛被其他人調整，已重新載入，請再試一次。' : errorMessage(e));
      onChanged();
    }
  };

  const rows = items ?? [];
  const headingId = `fbv-${view.id}-name`;
  const tableId = `fbv-${view.id}-table`;
  return (
    <section className="fbv" data-color={view.color} aria-labelledby={headingId} data-drop-view={dropView || undefined}
      onDragOver={(e) => { if (viewDragging.current && viewDragging.current !== view.id) { e.preventDefault(); setDropView(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropView(false); }}
      onDrop={(e) => { if (viewDragging.current && viewDragging.current !== view.id) { e.preventDefault(); onDropView(viewDragging.current); } setDropView(false); }}>
      {/* LIST-02/08/09: handle, name, count, space, then the table menu and the collapse button */}
      <div className="fbv-head">
        <IconTip label="拖曳調整表格順序（或聚焦後按 ↑／↓）">
          <button type="button" className="fbv-grip" draggable data-view-grip={view.id} aria-label={`調整「${viewName(view)}」表格順序，第 ${index + 1} 個，共 ${count} 個；按上下鍵移動`}
            onDragStart={(e) => { viewDragging.current = view.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', view.id); }}
            onDragEnd={() => { viewDragging.current = null; }}
            onKeyDown={(e) => { if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); onMoveView(-1); } if (e.key === 'ArrowDown' && index < count - 1) { e.preventDefault(); onMoveView(1); } }}>
            <GripVerticalIcon aria-hidden="true" />
          </button>
        </IconTip>
        <h2 id={headingId} className="fbv-name">{viewName(view)}</h2>
        <span className="fbv-count num" aria-label={`共 ${total ?? 0} 筆`}>{total ?? '…'}</span>
        <span className="fbv-spacer" />
        <DropdownMenu modal={false}>
          <IconTip label="表格操作">
            <DropdownMenuTrigger asChild>
              <button type="button" className="fbv-icon" aria-label={`「${viewName(view)}」表格操作`}><MoreHorizontalIcon aria-hidden="true" /></button>
            </DropdownMenuTrigger>
          </IconTip>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem disabled={index === 0} onSelect={() => onMoveView(-1)}>上移表格</DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMoveView(1)}>下移表格</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>移除表格</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconTip label={collapsed ? '展開表格' : '收合表格'}>
          <button type="button" className="fbv-icon fbv-collapse" aria-expanded={!collapsed} aria-controls={tableId} aria-label={`${collapsed ? '展開' : '收合'}「${viewName(view)}」`} onClick={toggle}>
            <ChevronDownIcon aria-hidden="true" />
          </button>
        </IconTip>
      </div>
      <div id={tableId} hidden={collapsed}>
        {actionError ? <div className="banner banner-error fbv-banner" role="alert">{actionError}</div> : null}
        {/* LIST-15: the table scrolls sideways inside itself on narrow screens */}
        <div className="fbv-scroll" tabIndex={-1}>
          <div className="fbv-table" role="table" aria-labelledby={headingId} aria-rowcount={total ?? undefined}>
            <div className="fbv-row fbv-header" role="row">
              <span role="columnheader">標題／描述</span>
              <span role="columnheader">分類</span>
              <span role="columnheader">負責人</span>
              <span role="columnheader">留言</span>
              <span role="columnheader" aria-sort={view.sortMode === 'created' ? 'descending' : 'none'}>
                <button type="button" className="fbv-sort" onClick={() => void sortByCreated()}
                  aria-label={view.sortMode === 'created' ? '建立時間（目前依建立時間排序，最新在上）' : '建立時間（目前為手動排序；按下改回依建立時間，最新在上）'}>
                  建立時間{view.sortMode === 'created' ? <ArrowDownIcon aria-hidden="true" /> : <span className="fbv-manual">手動</span>}
                </button>
              </span>
            </div>
            {items === null && !error ? <div className="fbv-state" role="row"><span role="cell"><LoadingState /></span></div>
              : error ? <div className="fbv-state" role="row"><span role="cell"><ErrorState message={error} onRetry={() => onChanged()} /></span></div>
                // F07: grey text; "no match" (with search or filters) reads differently from "none yet"
                : rows.length === 0 ? <div className="fbv-state fbv-empty" role="row"><span role="cell">{query ? '沒有符合目前搜尋或篩選條件的 Feedback。' : '這個表格目前沒有 Feedback。'}</span></div>
                  : rows.map((f, i) => (
                    <Row key={f.id} f={f} P={P} tax={tax} viewId={view.id} drop={dropRow === f.id}
                      onOpen={() => onOpen(f.id)} onChanged={onChanged} onTaxonomyChanged={onTaxonomyChanged} announce={announce}
                      onUpdated={(n) => setItems((list) => list?.map((x) => (x.id === n.id ? n : x)) ?? list)}
                      onDragOverRow={(over) => setDropRow(over ? f.id : null)}
                      onDropRow={(dragged) => { setDropRow(null); if (dragged !== f.id) void move(dragged, f.id); }}
                      onKey={(dir) => {
                        // Alt+↑／↓: one place up or down within this table
                        if (dir === -1 && i > 0) void move(f.id, rows[i - 1].id);
                        if (dir === 1 && i < rows.length - 1) {
                          // before the row after the next one; last when every row is loaded
                          if (i + 2 < rows.length) void move(f.id, rows[i + 2].id);
                          else if (!cursor) void move(f.id, null);
                          else void loadMore();
                        }
                      }} />
                  ))}
            {rows.length > 0 ? (
              // dropping below the last row puts it last (only when every row is loaded)
              <div className="fbv-end" data-drop={dropRow === 'end' || undefined} aria-hidden="true"
                onDragOver={(e) => { if (dragging.current?.viewId === view.id && !cursor) { e.preventDefault(); setDropRow('end'); } }}
                onDragLeave={() => setDropRow(null)}
                onDrop={(e) => { e.preventDefault(); setDropRow(null); const d = dragging.current; if (d?.viewId === view.id && !cursor) void move(d.feedbackId, null); }} />
            ) : null}
          </div>
        </div>
        {cursor ? <div className="fbv-more"><Button size="sm" variant="ghost" pending={loadingMore} onClick={() => void loadMore()}>載入更多（已顯示 {rows.length}／{total}）</Button></div> : null}
      </div>
    </section>
  );
}

function Row({ f, P, tax, viewId, drop, onOpen, onChanged, onTaxonomyChanged, onUpdated, onDragOverRow, onDropRow, onKey, announce }: {
  f: Feedback; P: string; tax: Taxonomy; viewId: string; drop: boolean;
  onOpen: () => void; onChanged: () => void; onTaxonomyChanged: () => void; onUpdated: (f: Feedback) => void;
  onDragOverRow: (over: boolean) => void; onDropRow: (draggedId: string) => void; onKey: (dir: -1 | 1) => void; announce: (m: string) => void;
}) {
  // LIST-04: attributes changed in place are saved at once; then every table reloads (LIST-07)
  const saver = useAttributeSaver(`${P}/feedback/${f.id}`, f, onUpdated, onChanged);
  const value = attrsOf(f);
  const justDragged = useRef(false);
  // LIST-15: a click on the row (not on its controls, not ending a text selection or a drag) opens it
  const openFromRow = (e: React.MouseEvent) => {
    if (justDragged.current) return;
    const target = e.target as HTMLElement;
    const control = target.closest('button, a, input, select, textarea, [role="menu"], [role="menuitem"], [data-radix-popper-content-wrapper]');
    if (control && !control.classList.contains('fbv-title')) return;
    if (String(window.getSelection() ?? '').trim()) return;
    onOpen();
  };
  return (
    <div className={cn('fbv-row fbv-item', drop && 'fbv-drop')} role="row" draggable data-feedback-id={f.id} aria-busy={saver.saving || undefined}
      onClick={openFromRow}
      onDragStart={(e) => {
        // controls inside the row never start a drag
        if ((e.target as HTMLElement).closest?.('button:not(.fbv-title), [role="menu"]') && e.target !== e.currentTarget) { e.preventDefault(); return; }
        dragging.current = { viewId, feedbackId: f.id };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', f.id);
      }}
      onDragEnd={() => { dragging.current = null; justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 0); }}
      onDragOver={(e) => {
        // LIST-10: only rows of this same table accept a drop; nothing moves across tables
        if (dragging.current?.viewId !== viewId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOverRow(true);
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragOverRow(false); }}
      onDrop={(e) => { const d = dragging.current; if (d?.viewId !== viewId) return; e.preventDefault(); onDropRow(d.feedbackId); }}>
      <span role="cell" className="fbv-cell-title">
        <button type="button" className="fbv-title" onClick={(e) => { e.stopPropagation(); onOpen(); }}
          onKeyDown={(e) => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); onKey(e.key === 'ArrowUp' ? -1 : 1); } }}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">{f.title}</button>
        {f.description.trim() ? <span className="fbv-desc">{summary(f.description)}</span> : null}
      </span>
      <span role="cell" onDragStart={(e) => e.preventDefault()}>
        <AttributePills taxonomy={tax} value={value} onChange={(p) => void saver.save(p)} announce={announce} disabled={saver.saving}
          parts={{ category: true }} compact label={`「${f.title}」的分類`}
          onCreateTag={async (name) => { const tag = await createProductTag(P, name); onTaxonomyChanged(); return tag; }} />
        {saver.state.kind === 'error' ? <span className="fbv-row-error" role="alert">{saver.state.text}</span> : null}
      </span>
      <span role="cell" onDragStart={(e) => e.preventDefault()}>
        <PersonTagPill taxonomy={tax} value={value.personTagIds} onChange={(personTagIds) => void saver.save({ personTagIds })} disabled={saver.saving} />
      </span>
      <span role="cell" className="fbv-comments"><MessageCircleIcon aria-hidden="true" />留言 {f.commentCount}</span>
      {/* LIST-12: the creation time, relative, with the full date and time as a hint */}
      <span role="cell"><time className="fbv-time" dateTime={f.createdAt} title={formatDateTime(f.createdAt)}>{relativeTime(f.createdAt)}</time></span>
    </div>
  );
}
