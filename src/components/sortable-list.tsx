'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { GripVerticalIcon } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from 'cn';

/**
 * Reorderable list with a drag handle (UI/UX checklist R15/R16). shadcn/ui has no official sortable
 * component, so this is the project's own pattern, built on shadcn Popover and Lucide icons, with no
 * new dependency:
 * - Only the handle starts a drag (pointer: mouse, pen and touch), so typing in a row's input never drags it.
 * - Keyboard: ArrowUp / ArrowDown (Home / End) on the focused handle moves the row; focus stays on it.
 * - Single pointer without dragging (WCAG 2.5.7): a click or tap on the handle opens a small move menu.
 * - Escape during a drag puts the row back. Every move is announced in a polite live region.
 * The order is only reported through onChange; the caller decides when to save.
 */
export interface SortableItem { id: string; name: string; content: ReactNode }

const DRAG_THRESHOLD = 4;

export function SortableList({ items, order, onChange, label }: { items: SortableItem[]; order: string[]; onChange: (order: string[]) => void; label: string }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows = order.map((id) => byId.get(id)).filter((x): x is SortableItem => Boolean(x));
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const handleRefs = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{ id: string; startY: number; start: string[]; moved: boolean; pointerId: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  // the latest order and callback for the window listeners of a drag in progress
  const latest = useRef({ order, onChange });
  useLayoutEffect(() => { latest.current = { order, onChange }; });

  const announce = (id: string, next: string[]) => {
    const name = byId.get(id)?.name ?? '';
    setMessage(`「${name}」移到第 ${next.indexOf(id) + 1} 個位置，共 ${next.length} 個`);
  };
  const moveTo = (id: string, index: number, current = order) => {
    const from = current.indexOf(id);
    const to = Math.max(0, Math.min(current.length - 1, index));
    if (from < 0 || from === to) return current;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, id);
    latest.current.order = next; // further moves of the same drag start from here, before the re-render
    latest.current.onChange(next);
    return next;
  };

  const justDragged = useRef(false);

  // the drag follows the pointer on the window (rows move in the DOM while dragging, so pointer capture
  // on the handle itself could be lost); Escape puts the row back where it started
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, id: string) => {
    if (e.button !== 0 || drag.current) return;
    const d = { id, startY: e.clientY, start: order, moved: false, pointerId: e.pointerId };
    drag.current = d;
    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return;
      if (!d.moved) {
        if (Math.abs(ev.clientY - d.startY) < DRAG_THRESHOLD) return;
        d.moved = true;
        setDragging(d.id);
        setMenuFor(null);
      }
      ev.preventDefault();
      // the row goes where the pointer is: past the middle of a neighbouring row, it takes that place
      const current = latest.current.order;
      let index = 0;
      for (const other of current) {
        if (other === d.id) continue;
        const r = rowRefs.current.get(other)?.getBoundingClientRect();
        if (r && ev.clientY > r.top + r.height / 2) index += 1;
      }
      if (current.indexOf(d.id) !== index) moveTo(d.id, index, current);
    };
    const finish = (cancelled: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      drag.current = null;
      if (!d.moved) return; // a click: onClick opens the move menu
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 0);
      setDragging(null);
      if (cancelled) { latest.current.onChange(d.start); setMessage('已取消移動'); return; }
      announce(d.id, latest.current.order);
    };
    const up = (ev: globalThis.PointerEvent) => { if (ev.pointerId === d.pointerId) finish(false); };
    const cancel = (ev: globalThis.PointerEvent) => { if (ev.pointerId === d.pointerId) finish(true); };
    const key = (ev: globalThis.KeyboardEvent) => { if (ev.key === 'Escape' && d.moved) { ev.preventDefault(); ev.stopPropagation(); finish(true); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const i = order.indexOf(id);
    const target = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : null;
    if (target === null) return;
    e.preventDefault();
    const next = moveTo(id, target);
    if (next !== order) announce(id, next);
    // the row re-renders in its new place; keep the focus on its handle
    requestAnimationFrame(() => handleRefs.current.get(id)?.focus());
  };
  const menuMove = (id: string, index: number) => {
    const next = moveTo(id, index);
    if (next !== order) announce(id, next);
    setMenuFor(null);
    requestAnimationFrame(() => handleRefs.current.get(id)?.focus());
  };

  return (
    <>
      <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((item, i) => (
          <li key={item.id} ref={(el) => { if (el) rowRefs.current.set(item.id, el); else rowRefs.current.delete(item.id); }}
            data-dragging={dragging === item.id || undefined}
            className={cn('flex min-w-0 items-center gap-2 rounded-md transition-shadow', dragging === item.id && 'relative z-10 bg-background shadow-md ring-2 ring-ring/40')}>
            <Popover open={menuFor === item.id} onOpenChange={(o) => setMenuFor(o ? item.id : null)}>
              <PopoverAnchor asChild>
                <button ref={(el) => { if (el) handleRefs.current.set(item.id, el); else handleRefs.current.delete(item.id); }}
                  type="button" aria-label={`調整「${item.name}」的順序，目前第 ${i + 1} 個`} aria-describedby="sortable-hint" aria-haspopup="dialog" aria-expanded={menuFor === item.id}
                  className={cn('inline-flex size-9 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground outline-none select-none hover:bg-[var(--raised)] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:size-11',
                    dragging === item.id ? 'cursor-grabbing' : 'cursor-grab')}
                  onPointerDown={(e) => onPointerDown(e, item.id)}
                  onKeyDown={(e) => onKeyDown(e, item.id)}
                  onClick={() => { if (!justDragged.current) setMenuFor((m) => (m === item.id ? null : item.id)); }}>
                  <GripVerticalIcon aria-hidden="true" className="size-4" />
                </button>
              </PopoverAnchor>
              <PopoverContent align="start" className="w-44 p-1" aria-label={`移動「${item.name}」`}
                onCloseAutoFocus={(e) => { e.preventDefault(); handleRefs.current.get(item.id)?.focus(); }}>
                {[
                  { label: '移到最前', to: 0, disabled: i === 0 },
                  { label: '上移', to: i - 1, disabled: i === 0 },
                  { label: '下移', to: i + 1, disabled: i === rows.length - 1 },
                  { label: '移到最後', to: rows.length - 1, disabled: i === rows.length - 1 },
                ].map((a) => (
                  <button key={a.label} type="button" disabled={a.disabled} onClick={() => menuMove(item.id, a.to)}
                    className="flex min-h-9 w-full items-center rounded-sm px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50">
                    {a.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <div className="flex min-w-0 flex-1 items-center gap-2">{item.content}</div>
          </li>
        ))}
      </ul>
      <p id="sortable-hint" className="sr-only">拖曳把手，或按上下方向鍵調整順序；點選把手可開啟移動選單。</p>
      <p className="sr-only" aria-live="polite">{message}</p>
    </>
  );
}
