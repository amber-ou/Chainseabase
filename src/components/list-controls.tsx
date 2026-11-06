'use client';

import { useId, type ReactNode } from 'react';
import { ListFilterIcon, SearchIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Shared list toolbar controls (UI/UX checklist F01–F09, R06, R10, R11): a search box built from
 * shadcn/ui Input Group, and one icon-only Filter button opening a popover with the filters.
 * Only what is listed changes; the data is never modified here.
 */

/** Search with a leading icon. The placeholder is a hint only; the field keeps its own accessible name. */
export function SearchBox({ id, label, value, onChange, placeholder = '搜尋標題或描述…', maxLength = 200, className }: {
  id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string; maxLength?: number; className?: string;
}) {
  return (
    <InputGroup className={`bg-background ${className ?? ''}`}>
      <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
      <InputGroupInput id={id} type="search" aria-label={label} placeholder={placeholder} maxLength={maxLength} value={value}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.preventDefault(); onChange(''); } }} />
      {value ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="清除搜尋" onClick={() => { onChange(''); document.getElementById(id)?.focus(); }}><XIcon /></InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

/**
 * Icon-only Filter button (tooltip 「篩選」, accessible name 「篩選」) with a dot while any filter is
 * applied. The popover holds the given filter sections and a 清除篩選 action.
 */
export function FilterPopover({ active, onClear, children }: { active: boolean; onClear: () => void; children: ReactNode }) {
  const titleId = useId();
  return (
    <Popover>
      <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="relative bg-background" aria-label={active ? '篩選（已套用篩選）' : '篩選'}>
              <ListFilterIcon aria-hidden="true" />
              {active ? <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-background" /> : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>篩選</TooltipContent>
      </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" collisionPadding={16} aria-labelledby={titleId} className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(20rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 id={titleId} className="m-0 text-sm font-medium">篩選</h2>
          <Button variant="ghost" size="sm" disabled={!active} onClick={onClear}>清除篩選</Button>
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-3">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

/** An icon-only button with a tooltip that repeats its accessible name (R09). */
export function IconTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** One titled group of choices inside the Filter popover. */
export function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1.5">
      <div id={id} className="text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

export interface ChoiceOption { id: string; label: string; group?: string | null }

/** Single choice (radio list), with an explicit 「全部」 option meaning no filter. */
export function RadioChoices({ name, value, onChange, options, allLabel }: { name: string; value: string; onChange: (id: string) => void; options: ChoiceOption[]; allLabel?: string }) {
  const all = allLabel !== undefined ? [{ id: '', label: allLabel }, ...options] : options;
  return (
    <div className="flex flex-col">
      {all.map((o) => (
        <label key={o.id || 'all'} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-[var(--sunken)]">
          <input type="radio" name={name} className="size-4 accent-[var(--primary)]" checked={value === o.id} onChange={() => onChange(o.id)} />
          <span className="min-w-0 truncate">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

/** Multiple choice (checkboxes), grouped by option group. */
export function CheckChoices({ value, onChange, options, emptyLabel = '沒有可用的選項' }: { value: string[]; onChange: (ids: string[]) => void; options: ChoiceOption[]; emptyLabel?: string }) {
  if (!options.length) return <p className="m-0 px-2 text-sm text-muted-foreground">{emptyLabel}</p>;
  const groups = new Map<string, ChoiceOption[]>();
  for (const o of options) {
    const g = o.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  }
  return (
    <div className="flex flex-col gap-1">
      {[...groups.entries()].map(([g, opts]) => (
        <div key={g || 'none'} role={g ? 'group' : undefined} aria-label={g || undefined} className="flex flex-col">
          {g ? <div className="px-2 pt-1 text-xs text-muted-foreground">{g}</div> : null}
          {opts.map((o) => (
            <label key={o.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-[var(--sunken)]">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={value.includes(o.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((v) => v !== o.id))} />
              <span className="min-w-0 truncate">{o.label}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

/** F07: an empty or no-result message in grey text only (no box, border or button). */
export function QuietEmpty({ children }: { children: ReactNode }) {
  return <p role="status" className="m-0 py-10 text-center text-sm text-[var(--muted)]">{children}</p>;
}
