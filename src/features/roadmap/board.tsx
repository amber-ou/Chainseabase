'use client';

import { useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui';
import { ActionMenu, type MenuItemDef } from '@/components/menu';

export interface BoardCard { id: string; title: string; revision: number; author: { id: string; displayName: string; avatarUrl: string | null }; createdAt: string; tags?: { name: string; groupName: string | null }[]; version?: { name: string } | null; status?: { name: string } }
export interface BoardColumn { id: string; label: ReactNode; title: string; count: number; cards: BoardCard[]; isDefault?: boolean; headerExtra?: ReactNode }

/**
 * Shared kanban (Roadmap = blue mark, Personal = teal mark). Native drag and
 * drop plus a per-card menu (move to column / up / down) for keyboard & touch.
 */
export function Board({ columns, accent, onMove, pendingId, readOnly, onOpen, cardExtra }: {
  columns: BoardColumn[];
  accent: 'roadmap' | 'personal';
  onMove?: (cardId: string, targetColumnId: string, beforeId: string | null, afterId: string | null) => void;
  pendingId?: string | null;
  readOnly?: boolean;
  onOpen?: (cardId: string) => void;
  cardExtra?: (card: BoardCard) => ReactNode;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ col: string; index: number } | null>(null);

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
      items.push({ label: c.title, onSelect: () => onMove?.(card.id, c.id, c.cards[0]?.id ?? null, null) });
    }
    items.push({ separator: true });
    items.push({ label: '上移', disabled: i === 0, onSelect: () => onMove?.(card.id, col.id, col.cards[i - 1].id, i >= 2 ? col.cards[i - 2].id : null) });
    items.push({ label: '下移', disabled: i === col.cards.length - 1, onSelect: () => onMove?.(card.id, col.id, i + 2 < col.cards.length ? col.cards[i + 2].id : null, col.cards[i + 1].id) });
    items.push({ label: '移到最上方', disabled: i === 0, onSelect: () => onMove?.(card.id, col.id, col.cards[0].id, null) });
    return items;
  };

  return (
    <>
      {readOnly ? null : <p className="board-swipe-hint small muted" aria-hidden="true">左右滑動查看其他欄位（共 {columns.length} 欄）</p>}
      {/* focusable so keyboard users can scroll the columns horizontally (WCAG 2.1.1) */}
      <div className={`board-scroll${readOnly ? ' board-stack-mobile' : ''}`} tabIndex={0} role="region" aria-label="看板，可左右捲動">
        <div className="board" role="list" aria-label="看板欄位">
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
              <div className="column-head">
                <span className={`mark mark-${accent}`} aria-hidden="true" />
                <span className="label">{col.label}</span>
                <span className="muted num small" aria-label={`共 ${col.count} 筆`}>{col.count}</span>
                {col.headerExtra}
              </div>
              <div className="column-body">
                {col.cards.map((card, i) => (
                  <div key={card.id}>
                    {drop?.col === col.id && drop.index === i ? <div className="drop-line" aria-hidden="true" /> : null}
                    <article className="kcard" data-pending={pendingId === card.id || undefined} draggable={!readOnly}
                      aria-label={card.title}
                      onDragStart={(e) => { setDragId(card.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.id); }}
                      onDragEnd={() => { setDragId(null); setDrop(null); }}
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
                      <button type="button" className="kcard-title" style={{ paddingRight: readOnly ? 0 : 28 }} onClick={() => onOpen?.(card.id)}>{card.title}</button>
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
                {col.cards.length === 0 ? <p className="small muted" style={{ padding: '8px 4px' }}>{readOnly ? '沒有卡片' : '拖曳卡片到這裡'}</p> : null}
                {col.count > col.cards.length ? <p className="small muted" style={{ padding: '0 4px' }}>另有 {col.count - col.cards.length} 筆未顯示</p> : null}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
