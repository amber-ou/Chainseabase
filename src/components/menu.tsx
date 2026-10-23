'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, useDismiss } from './ui';
import { IconMore } from './icons';

export interface MenuEntry { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
export type MenuItemDef = MenuEntry | { separator: true } | { heading: string };

/** Button + menu with arrow-key navigation (keyboard/touch alternative to drag). */
export function ActionMenu({ label, items, trigger, align = 'right' }: { label: string; items: MenuItemDef[]; trigger?: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const focusItem = (dir: 1 | -1 | 0) => {
    const els = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const next = dir === 0 ? 0 : (i + dir + els.length) % els.length;
    els[next].focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(-1); }
    if (e.key === 'Tab') setOpen(false);
  };
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <Button variant="ghost" size="sm" icon={!trigger} aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setTimeout(() => focusItem(0), 0); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setTimeout(() => focusItem(0), 0); } }}
      >{trigger ?? <IconMore />}</Button>
      {open ? (
        <div ref={menuRef} className="popover menu" role="menu" aria-label={label} onKeyDown={onKey} style={{ top: 'calc(100% + 4px)', [align]: 0 }}>
          {items.map((it, i) => {
            if ('separator' in it) return <div key={i} className="menu-sep" role="separator" />;
            if ('heading' in it) return <div key={i} className="menu-label">{it.heading}</div>;
            return (
              <button key={i} type="button" role="menuitem" className="menu-item" aria-disabled={it.disabled || undefined}
                style={it.danger ? { color: 'var(--negative)' } : undefined}
                onClick={() => { if (it.disabled) return; setOpen(false); it.onSelect(); }}
              >{it.label}</button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
