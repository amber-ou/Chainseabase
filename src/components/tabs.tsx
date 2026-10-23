'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef { id: string; label: ReactNode }

/** Tabs with roving focus (arrow keys, Home/End); selection is text + underline. */
export function Tabs({ tabs, value, onChange, label, children, after }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string; children?: ReactNode; after?: ReactNode }) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="tabs" role="tablist" aria-label={label} style={{ flex: 1 }}>
          {tabs.map((t, i) => (
            <button
              key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" type="button" className="tab"
              id={`${base}-tab-${t.id}`} aria-controls={`${base}-panel`} aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1}
              onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}
            >{t.label}</button>
          ))}
        </div>
        {after}
      </div>
      {children !== undefined ? <div className="tabpanel" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`}>{children}</div> : null}
    </div>
  );
}
