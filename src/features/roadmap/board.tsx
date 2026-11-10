'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { ActionMenu, type MenuItemDef } from '@/components/menu';

export interface BoardCard { id: string; title: string; revision: number; author: { id: string; displayName: string; avatarUrl: string | null }; createdAt: string; tags?: { name: string; groupName: string | null }[]; version?: { name: string } | null; status?: { name: string } }
export interface BoardColumn {
  id: string; label: ReactNode; title: string; count: number; cards: BoardCard[]; isDefault?: boolean;
  /** shown at the right end of the column header, after the flexible space (RM-03): Roadmap's ＋, Personal's column menu */
  headerExtra?: ReactNode;
}

/**
 * Shared kanban (Roadmap = blue mark, Personal = teal mark). Native drag and
 * drop plus a per-card menu (move to column / up / down) for keyboard & touch.
 */
export function Board({ columns, accent, onMove, pendingId, readOnly, onOpen, cardExtra, plain, hideUnloaded }: {
  columns: BoardColumn[];
  accent: 'roadmap' | 'personal';
  onMove?: (cardId: string, targetColumnId: string, beforeId: string | null, afterId: string | null) => void;
  pendingId?: string | null;
  readOnly?: boolean;
  onOpen?: (cardId: string) => void;
  cardExtra?: (card: BoardCard) => ReactNode;
  /** columns without their own background, border or rounded box (Roadmap, checklist R17): only cards are boxed */
  plain?: boolean;
  /** while the caller filters the cards, the "N more not shown" note is left out */
  hideUnloaded?: boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ col: string; index: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // card moved from its menu: a cross-column move remounts the card, so focus follows it
  const [followId, setFollowId] = useState<string | null>(null);
  useEffect(() => {
    if (!followId) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-card-id="${CSS.escape(followId)}"] .kcard-menu button`)?.focus();
  }, [columns, followId]);
  useEffect(() => {
    if (!followId) return;
    const t = setTimeout(() => setFollowId(null), 5000);
    return () => clearTimeout(t);
  }, [followId]);
  const menuMove = (cardId: string, targetColumnId: string, beforeId: string | null, afterId: string | null) => {
    setFollowId(cardId);
    onMove?.(cardId, targetColumnId, beforeId, afterId);
  };

  const scroll = useBoardScroll(rootRef, Boolean(plain), columns.length);
  // a drag that ends on the card must not also count as a click that opens it (CARD-06)
  const justDragged = useRef(false);
  /**
   * CARD-05..07: a click anywhere on a card opens it, except on the card's own controls (menu, links),
   * right after a drag, or when the click ended a text selection. The title stays the one keyboard
   * control (a real button; no nested interactive elements, no overlay over the card's content).
   */
  const openFromCard = (e: React.MouseEvent<HTMLElement>, cardId: string) => {
    if (!onOpen || justDragged.current) return;
    const target = e.target as HTMLElement;
    const control = target.closest('button, a, input, select, textarea, [role="menu"], [role="menuitem"], .kcard-menu');
    if (control && !control.classList.contains('kcard-title')) return;
    if (!control && window.getSelection()?.toString()) return;
    onOpen(cardId);
  };

  const finishDrop = (colId: string) => {
    if (!dragId || !onMove || !drop) return;
    const col = columns.find((c) => c.id === colId)!;
    const others = col.cards.filter((c) => c.id !== dragId);
    const srcIndexInCol = col.cards.findIndex((c) => c.id === dragId);
    let index = drop.index;
    if (srcIndexInCol >= 0 && srcIndexInCol < drop.index) index -= 1;
    const before = others[index]?.id ?? null;
    const after = index > 0 ? others[index - 1]?.id ?? null : null;
    onMove(dragId, colId, before, after);
    setDragId(null);
    setDrop(null);
  };

  const menuFor = (card: BoardCard, col: BoardColumn, i: number): MenuItemDef[] => {
    const items: MenuItemDef[] = [{ heading: '移至欄位' }];
    for (const c of columns) {
      if (c.id === col.id) continue;
      items.push({ label: c.title, onSelect: () => menuMove(card.id, c.id, c.cards[0]?.id ?? null, null) });
    }
    items.push({ separator: true });
    items.push({ label: '上移', disabled: i === 0, onSelect: () => menuMove(card.id, col.id, col.cards[i - 1].id, i >= 2 ? col.cards[i - 2].id : null) });
    items.push({ label: '下移', disabled: i === col.cards.length - 1, onSelect: () => menuMove(card.id, col.id, i + 2 < col.cards.length ? col.cards[i + 2].id : null, col.cards[i + 1].id) });
    items.push({ label: '移到最上方', disabled: i === 0, onSelect: () => menuMove(card.id, col.id, col.cards[0].id, null) });
    return items;
  };

  return (
    <>
      <p className="board-swipe-hint small muted" aria-hidden="true">左右滑動查看其他欄位（共 {columns.length} 欄）</p>
      <div className={plain ? 'board-frame' : 'board-wrap'}>
      {/* focusable so keyboard users can scroll the columns horizontally (WCAG 2.1.1); Roadmap (plain):
          arrows and Home / End on the container itself move one column / to either end (phase 3 III-R07) */}
      {/* CARD-03: every board (the portal's too) scrolls sideways inside itself on narrow screens; cards keep 300px */}
      {/* MASK-01..07: the scrolling container itself is masked (mask-image, CSS), 16px on each side always
          and wider on a side while columns are hidden past it; the arrows are outside it, unmasked */}
      <div ref={rootRef} className="board-scroll" tabIndex={0} role="region" aria-label="看板，可左右捲動"
        data-more-left={scroll.edges.left || undefined} data-more-right={scroll.edges.right || undefined}
        onKeyDown={plain ? scroll.onKeyDown : undefined}>
        <div className={`board${plain ? ' board-plain' : ''}`} role="list" aria-label="看板欄位"
          // RM-FIX02: the board itself is as wide as all its columns (never narrower than the space it has),
          // so its white surface and rules cover every column; the container around it scrolls sideways
          // CARD-01/02: fixed column widths from the 300px card (no 1fr sharing): one column stays on the left
          style={plain ? {
            gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, var(--board-col))`,
            width: `max(100%, calc(${Math.max(columns.length, 1)} * var(--board-col)))`,
          } : undefined}>
          {columns.map((col) => (
            <section key={col.id} className="column" role="listitem" aria-label={`${col.title}，${col.count} 筆`} data-drop={drop?.col === col.id || undefined}
              onDragOver={(e) => {
                if (readOnly || !dragId) return;
                e.preventDefault();
                if (drop?.col !== col.id) setDrop({ col: col.id, index: col.cards.length });
              }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null); }}
              onDrop={(e) => { e.preventDefault(); finishDrop(col.id); }}
            >
              {/* RM-03: mark, name, count right after the name, flexible space, then the column's own action */}
              <div className="column-head">
                <span className={`mark mark-${accent}`} aria-hidden="true" />
                <span className="label">{col.label}</span>
                <span className="column-count muted num small" aria-label={`共 ${col.count} 筆`}>{col.count}</span>
                {col.headerExtra ? <span className="column-head-end">{col.headerExtra}</span> : null}
              </div>
              <div className="column-body">
                {col.cards.map((card, i) => (
                  <div key={card.id}>
                    {drop?.col === col.id && drop.index === i ? <div className="drop-line" aria-hidden="true" /> : null}
                    <article className="kcard" data-card-id={card.id} data-pending={pendingId === card.id || undefined} draggable={!readOnly}
                      data-dragging={dragId === card.id || undefined}
                      aria-label={card.title}
                      onDragStart={(e) => { setDragId(card.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.id); }}
                      onDragEnd={() => { setDragId(null); setDrop(null); justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 0); }}
                      onClick={(e) => openFromCard(e, card.id)}
                      onDragOver={(e) => {
                        if (readOnly || !dragId) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const idx = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
                        if (drop?.col !== col.id || drop.index !== idx) setDrop({ col: col.id, index: idx });
                      }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); finishDrop(col.id); }}
                    >
                      <button type="button" className="kcard-title" style={{ paddingRight: readOnly ? 0 : 28 }}>{card.title}</button>
                      {cardExtra?.(card)}
                      <div className="kcard-foot">
                        <Avatar name={card.author.displayName} url={card.author.avatarUrl} id={card.author.id} size={18} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.author.displayName}</span>
                      </div>
                      {!readOnly ? <div className="kcard-menu"><ActionMenu label={`移動「${card.title}」`} items={menuFor(card, col, i)} /></div> : null}
                    </article>
                  </div>
                ))}
                {drop?.col === col.id && drop.index >= col.cards.length && col.cards.length > 0 ? <div className="drop-line" aria-hidden="true" /> : null}
                {col.cards.length === 0 ? <p className={`small muted${plain ? ' column-empty' : ''}`} style={{ padding: '8px 4px' }}>{readOnly ? '沒有卡片' : hideUnloaded ? '沒有符合的卡片' : '拖曳卡片到這裡'}</p> : null}
                {!hideUnloaded && col.count > col.cards.length ? <p className="small muted" style={{ padding: '0 4px' }}>另有 {col.count - col.cards.length} 筆未顯示</p> : null}
              </div>
            </section>
          ))}
        </div>
      </div>
      {plain && (scroll.edges.left || scroll.edges.right) ? (
        <>
          {/* III-R05: only when the board is wider than its space; one column per press */}
          <button type="button" className="board-arrow board-arrow-left" aria-label="向左捲動看板" disabled={!scroll.edges.left} onClick={() => scroll.by(-1)}><ChevronLeftIcon aria-hidden="true" /></button>
          <button type="button" className="board-arrow board-arrow-right" aria-label="向右捲動看板" disabled={!scroll.edges.right} onClick={() => scroll.by(1)}><ChevronRightIcon aria-hidden="true" /></button>
        </>
      ) : null}
      </div>
    </>
  );
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Horizontal board navigation (phase 3 III-R05 to III-R07), for the Roadmap board only.
 * - edges: whether there is more to the left / right (1px tolerance), kept current on scroll and on
 *   resize of the container or its content (ResizeObserver).
 * - by(±1): scroll by the real width of one column; smooth unless reduced motion is preferred.
 * - Wheel over the board: the larger of deltaX / deltaY moves it sideways (line mode × 16, page mode ×
 *   the visible width). Not taken when Ctrl is held (zoom), when nothing overflows, when the delta is
 *   zero or when the board is already at that end, so the page scrolls as usual. Touch and trackpad
 *   horizontal gestures are the native scrolling of the container.
 * - Keys on the container itself (never on a card or control inside it): ← / → one column, Home / End.
 */
function useBoardScroll(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean, count: number) {
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const next = { left: el.scrollLeft > 1, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 1 };
      setEdges((cur) => (cur.left === next.left && cur.right === next.right ? cur : next));
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? el.clientWidth : 1;
      const canMove = delta < 0 ? el.scrollLeft > 0 : el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
      if (!delta || !canMove) return;
      e.preventDefault();
      el.scrollLeft += delta * scale;
    };
    // the edges are tracked on every board (BOARD-01..03: the fades); the wheel mapping stays Roadmap's
    el.addEventListener('scroll', update, { passive: true });
    if (enabled) el.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    update();
    return () => {
      el.removeEventListener('scroll', update);
      el.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
  }, [ref, enabled, count]);
  const by = useCallback((dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const width = el.querySelector('.column')?.getBoundingClientRect().width ?? 333;
    el.scrollBy({ left: dir * width, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [ref]);
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); by(e.key === 'ArrowLeft' ? -1 : 1); }
    else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.currentTarget.scrollTo({ left: e.key === 'Home' ? 0 : e.currentTarget.scrollWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }, [by]);
  return { edges, by, onKeyDown };
}
