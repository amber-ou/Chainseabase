'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { useDismiss } from './ui';
import { IconChevronDown } from './icons';

export interface MsOption { id: string; label: string; group?: string | null; single?: boolean }

/**
 * Searchable checkbox list. Options of a "single" group replace each other.
 * `noneLabel` renders a reserved exclusive option (e.g. 未安排) meaning "no value".
 */
export function MultiSelect({ label, options, value, onChange, noneLabel, placeholder = '未選擇', disabled, id }: {
  label: string; options: MsOption[]; value: string[]; onChange: (ids: string[]) => void; noneLabel?: string; placeholder?: string; disabled?: boolean; id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const auto = useId();
  const listId = `${id ?? auto}-list`;
  useDismiss(open, () => setOpen(false), ref);
  const filtered = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())), [options, q]);
  const groups = useMemo(() => {
    const m = new Map<string, MsOption[]>();
    for (const o of filtered) {
      const g = o.group ?? '';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(o);
    }
    return [...m.entries()];
  }, [filtered]);
  const selected = options.filter((o) => value.includes(o.id));
  const toggle = (o: MsOption) => {
    if (value.includes(o.id)) onChange(value.filter((v) => v !== o.id));
    else if (o.single && o.group !== undefined) {
      const sameGroup = options.filter((x) => x.group === o.group).map((x) => x.id);
      onChange([...value.filter((v) => !sameGroup.includes(v)), o.id]);
    } else onChange([...value, o.id]);
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        id={id} type="button" className="ms-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} disabled={disabled}
        aria-label={`${label}：${selected.length ? selected.map((s) => s.label).join('、') : (noneLabel ?? placeholder)}`}
        onClick={() => setOpen((o) => !o)}
      >
        {selected.length ? selected.map((s) => <span key={s.id} className="chip">{s.group ? <span className="chip-group">{s.group}：</span> : null}{s.label}</span>) : <span className="muted">{noneLabel ?? placeholder}</span>}
        <IconChevronDown style={{ marginLeft: 'auto' }} />
      </button>
      {open ? (
        <div className="popover" style={{ top: 'calc(100% + 4px)', left: 0, right: 0 }}>
          <input className="input" placeholder="搜尋…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`搜尋${label}`} autoFocus />
          <div className="ms-list" id={listId} role="listbox" aria-multiselectable="true" aria-label={label}>
            {noneLabel ? (
              <label className="ms-option">
                <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} />
                <span>{noneLabel}</span>
              </label>
            ) : null}
            {groups.map(([g, opts]) => (
              <div key={g} role="group" aria-label={g || '未分組'}>
                {g ? <div className="menu-label">{g}{opts[0]?.single ? '（單選）' : '（複選）'}</div> : (groups.length > 1 ? <div className="menu-label">未分組</div> : null)}
                {opts.map((o) => (
                  <label key={o.id} className="ms-option">
                    <input type={o.single ? 'radio' : 'checkbox'} name={o.single ? `${listId}-${g}` : undefined} checked={value.includes(o.id)} onChange={() => toggle(o)} onClick={(e) => { if (o.single && value.includes(o.id)) { e.preventDefault(); toggle(o); } }} />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            ))}
            {filtered.length === 0 ? <div className="muted small" style={{ padding: 8 }}>沒有符合的選項</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
