'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CircleDotIcon, FlagIcon, GlobeIcon, LayoutGridIcon, LoaderCircleIcon, LockIcon, PlusIcon, SearchIcon, TagIcon, UserRoundIcon } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/client/api';
import { PRIORITY_LABEL } from '@/client/format';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { IconTip } from '@/components/list-controls';
import { tagOptions, versionGroup, type Feedback, type Taxonomy } from './types';
import { cn } from 'cn';

/**
 * Feedback attributes (2026-11-10, ATTR-01..07 and the instant-save rules), shared by creating, viewing
 * and editing a Feedback and by the Feedback tables.
 *
 * - Pills in order: status, category, Person tag, the chosen tags, version, priority, then ＋ (always
 *   last). ＋ selects or creates general tags and has 優先級 and 版本 lists (second level, by click,
 *   keyboard or touch; no hover). Priority and version pills change their value (a menu), unlike a
 *   general tag pill, which takes that tag off this Feedback (the shared tag stays).
 * - On a created Feedback each change is saved at once (`useAttributeSaver`): one request at a time,
 *   each with the revision the previous one returned; a conflict with someone else's change of the
 *   same attribute reloads and says so instead of overwriting; a conflict on another attribute is
 *   retried on the new revision. Failures leave the last saved value and say so.
 */
export type Priority = Feedback['priority'];
export interface AttrValue {
  statusId: string; categoryId: string; personTagIds: string[]; tagIds: string[]; versionTagId: string | null;
  priority: Priority; visibility: Feedback['visibility'];
}
export const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3'];

export function attrsOf(f: Feedback): AttrValue {
  return {
    statusId: f.status.id, categoryId: f.category.id, personTagIds: f.personTags.map((p) => p.id),
    tagIds: f.tags.filter((t) => !t.isVersion).map((t) => t.id), versionTagId: f.version?.id ?? null,
    priority: f.priority, visibility: f.visibility,
  };
}

export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; text: string };

/**
 * Saves attribute changes of a created Feedback immediately (instant-save rules), one request after
 * another. `apply` receives the server's Feedback after each save (or after a reload on a conflict).
 */
export function useAttributeSaver(path: string, feedback: Feedback | undefined, apply: (f: Feedback) => void, onChanged?: () => void) {
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const latest = useRef(feedback);
  useEffect(() => { latest.current = feedback; }, [feedback]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const applyRef = useRef(apply);
  const changedRef = useRef(onChanged);
  useEffect(() => { applyRef.current = apply; changedRef.current = onChanged; });

  const save = useCallback((patch: Partial<AttrValue>) => {
    const run = async () => {
      const before = latest.current;
      if (!before) return false;
      const body: Record<string, unknown> = { ...patch };
      // the tag list without the version keeps the version as it is (and the other way round)
      if ('tagIds' in patch && !('versionTagId' in patch)) body.versionTagId = before.version?.id ?? null;
      setState({ kind: 'saving' });
      const send = (revision: number) => api.patch<Feedback>(path, { body: { ...body, expectedRevision: revision } });
      try {
        let r;
        try {
          r = await send(before.revision);
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409)) throw e;
          // someone else saved meanwhile: retry only when they did not change what this change touches
          const server = (await api.get<Feedback>(path)).data;
          const a = attrsOf(before), b = attrsOf(server);
          const keys = Object.keys(body) as (keyof AttrValue)[];
          if (keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))) {
            r = await send(server.revision);
          } else {
            latest.current = server;
            applyRef.current(server);
            setState({ kind: 'error', text: '這個屬性剛被其他人修改，已載入最新的值，請確認後再改一次。' });
            return false;
          }
        }
        latest.current = r.data;
        applyRef.current(r.data);
        changedRef.current?.();
        setState({ kind: 'saved' });
        return true;
      } catch (e) {
        setState({ kind: 'error', text: `${errorMessage(e)}屬性維持原本的值。` });
        return false;
      }
    };
    const p = queue.current.then(run, run);
    queue.current = p;
    return p;
  }, [path]);
  return { save, state, saving: state.kind === 'saving' };
}

/** A new ungrouped tag of the product (the same rules as Setting), at the product's current revision. */
export async function createProductTag(productPath: string, name: string) {
  const t = await api.get<Taxonomy>(`${productPath}/taxonomy`);
  const r = await api.post<{ tag: { id: string; name: string } }>(`${productPath}/tags`, { body: { name, groupId: null, expectedRevision: t.data.productRevision } });
  return r.data.tag;
}

/** The save state of instant attribute changes, announced politely. */
export function SaveStatus({ state, note }: { state: SaveState; note?: string }) {
  return (
    <p className="fbc-save-state" data-kind={state.kind} role="status" aria-live="polite">
      {state.kind === 'saving' ? <><LoaderCircleIcon className="animate-spin" aria-hidden="true" />屬性儲存中…</>
        : state.kind === 'saved' ? <><CheckIcon aria-hidden="true" />屬性已儲存</>
          : state.kind === 'error' ? <span className="fbc-save-error">{state.text}</span>
            : note ?? null}
    </p>
  );
}

type TagOpt = { id: string; label: string; group: string | null; single: boolean };

export function useTagOptions(taxonomy: Taxonomy, extraTags: { id: string; label: string; group: null }[] = []) {
  return useMemo(() => [...new Map([
    ...tagOptions(taxonomy).map((o) => ({ id: o.id, label: o.label, group: o.group as string | null, single: 'single' in o ? Boolean(o.single) : false })),
    ...extraTags.map((t) => ({ ...t, single: false })),
  ].map((t) => [t.id, t] as const)).values()], [taxonomy, extraTags]);
}

/**
 * The attribute pills. `parts` picks which leading pills appear (the Feedback table shows category in
 * 分類 and Person tag in its own column); `showPriority` hides the priority pill until a create form
 * picks one (a created Feedback always has a priority, so it is always shown there).
 */
export function AttributePills({ taxonomy, value, onChange, extraTags = [], announce, onCreateTag, disabled, parts = { status: true, category: true, person: true }, showPriority = true, compact = false, label = 'Feedback 屬性' }: {
  taxonomy: Taxonomy; value: AttrValue; onChange: (p: Partial<AttrValue>) => void;
  extraTags?: { id: string; label: string; group: null }[]; announce: (m: string) => void;
  onCreateTag?: (name: string) => Promise<{ id: string; name: string }>; disabled?: boolean;
  parts?: { status?: boolean; category?: boolean; person?: boolean }; showPriority?: boolean; compact?: boolean; label?: string;
}) {
  const allTags = useTagOptions(taxonomy, extraTags);
  const status = taxonomy.statuses.find((s) => s.id === value.statusId);
  const category = taxonomy.categories.find((c) => c.id === value.categoryId);
  const chosenTags = value.tagIds.map((id) => allTags.find((t) => t.id === id)).filter((t): t is TagOpt => Boolean(t));
  const vg = versionGroup(taxonomy);
  const version = value.versionTagId ? vg?.tags.find((x) => x.id === value.versionTagId) : undefined;
  const addRef = useRef<HTMLButtonElement>(null);
  const toAdd = () => requestAnimationFrame(() => addRef.current?.focus());
  return (
    <div className={cn('fbc-pills', compact && 'fbc-pills-compact')} role="group" aria-label={label} aria-disabled={disabled || undefined}>
      {parts.status ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button type="button" className="fbc-pill fbc-pill-status" aria-label={`狀態：${status?.name ?? '未選擇'}`}>
              <CircleDotIcon aria-hidden="true" /><span className="fbc-pill-text">{status?.name ?? '狀態'}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuRadioGroup value={value.statusId} onValueChange={(v) => onChange({ statusId: v })}>
              {taxonomy.statuses.map((s) => <DropdownMenuRadioItem key={s.id} value={s.id}>{s.name}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {parts.category ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button type="button" className="fbc-pill fbc-pill-category" aria-label={`類別：${category?.name ?? '未選擇'}`}>
              {compact ? null : <LayoutGridIcon aria-hidden="true" />}<span className="fbc-pill-text">{category?.name ?? '類別'}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuRadioGroup value={value.categoryId} onValueChange={(v) => onChange({ categoryId: v })}>
              {taxonomy.categories.map((c) => <DropdownMenuRadioItem key={c.id} value={c.id}>{c.name}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {parts.person ? <PersonTagPill taxonomy={taxonomy} value={value.personTagIds} onChange={(personTagIds) => onChange({ personTagIds })} disabled={disabled} /> : null}
      {/* III-04: the chosen tags come before ＋, which stays last when the row wraps */}
      {chosenTags.map((t) => (
        <button key={t.id} type="button" className="fbc-pill fbc-tag" aria-label={`取消選取：${t.label}`} disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onChange({ tagIds: value.tagIds.filter((x) => x !== t.id) });
            announce(`已取消選取標籤「${t.label}」`);
            // the pill is gone: focus moves on to ＋ instead of falling to the page
            toAdd();
          }}>
          <span className="fbc-pill-text">{t.group ? `${t.group}：` : ''}{t.label}</span>
        </button>
      ))}
      {/* ATTR-03: version and priority, left of ＋; their menus change the value (they are not tags) */}
      {version ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button type="button" className="fbc-pill fbc-pill-version" aria-label={`版本：${version.name}（變更版本）`}>
              <TagIcon aria-hidden="true" /><span className="fbc-pill-text">版本：{version.name}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuRadioGroup value={value.versionTagId ?? ''} onValueChange={(v) => { onChange({ versionTagId: v || null }); if (!v) toAdd(); }}>
              <DropdownMenuRadioItem value="">未歸類（移除版本）</DropdownMenuRadioItem>
              {vg?.tags.map((t) => <DropdownMenuRadioItem key={t.id} value={t.id}>{t.name}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {showPriority ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button type="button" className="fbc-pill fbc-pill-priority" aria-label={`優先級：${PRIORITY_LABEL[value.priority]}（變更優先級）`}>
              <FlagIcon aria-hidden="true" /><span className="fbc-pill-text">{value.priority}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuRadioGroup value={value.priority} onValueChange={(v) => onChange({ priority: v as Priority })}>
              {PRIORITIES.map((k) => <DropdownMenuRadioItem key={k} value={k}>{PRIORITY_LABEL[k]}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <TagPicker ref={addRef} taxonomy={taxonomy} options={allTags} value={value} disabled={disabled}
        onChange={(p) => { onChange(p); if (p.priority) announce(`優先級：${PRIORITY_LABEL[p.priority]}`); else if ('versionTagId' in p) announce(p.versionTagId ? `版本：${vg?.tags.find((t) => t.id === p.versionTagId)?.name ?? ''}` : '已移除版本'); }}
        onCreate={onCreateTag ? async (name) => {
          const tag = await onCreateTag(name);
          onChange({ tagIds: [...value.tagIds, tag.id] });
          announce(`已建立並加入標籤「${tag.name}」`);
        } : undefined} />
    </div>
  );
}

/** Person tag: a multi-choice menu (「未安排」 clears it). Also the 負責人 column of the Feedback table. */
export function PersonTagPill({ taxonomy, value, onChange, disabled }: { taxonomy: Taxonomy; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const people = taxonomy.personTags.filter((t) => value.includes(t.id));
  const text = people.length ? people.map((t) => t.name).join('、') : '未安排';
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className="fbc-pill fbc-pill-person" aria-label={`Person tag：${text}`}>
          <UserRoundIcon aria-hidden="true" /><span className="fbc-pill-text">{text}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuCheckboxItem checked={value.length === 0} onSelect={(e) => e.preventDefault()} onCheckedChange={() => onChange([])}>未安排</DropdownMenuCheckboxItem>
        {taxonomy.personTags.length ? <DropdownMenuSeparator /> : null}
        {taxonomy.personTags.map((t) => (
          <DropdownMenuCheckboxItem key={t.id} checked={value.includes(t.id)} onSelect={(e) => e.preventDefault()}
            onCheckedChange={(c) => onChange(c ? [...value, t.id] : value.filter((x) => x !== t.id))}>{t.name}</DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** ATTR-04/05: 內部／公開, a small menu (create and edit footers). */
export function VisibilityControl({ value, onChange, disabled }: { value: Feedback['visibility']; onChange: (v: Feedback['visibility']) => void; disabled?: boolean }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className="fbc-visibility" aria-label={`公開範圍：${value === 'public' ? '公開' : '內部'}`}>
          {value === 'public' ? <GlobeIcon aria-hidden="true" /> : <LockIcon aria-hidden="true" />}
          <span>{value === 'public' ? '公開' : '內部'}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-60">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as Feedback['visibility'])}>
          <DropdownMenuRadioItem value="internal">內部：只有團隊後台可見</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="public">公開：前台可看到標題、描述、狀態與一般留言</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** ATTR-06: the view mode's read-only visibility line. */
export function VisibilityNote({ value }: { value: Feedback['visibility'] }) {
  return <p className="fd-visibility">{value === 'public' ? <GlobeIcon aria-hidden="true" /> : <LockIcon aria-hidden="true" />}公開範圍：{value === 'public' ? '公開' : '內部'}</p>;
}

/**
 * FB04, ATTR-02/07: the ＋ entry. Search existing tags (a single-choice group keeps one) or create one
 * with the typed name; 優先級 and 版本 open their own list in place (‹ 返回 goes back), by click,
 * keyboard or touch. Errors keep the typed name.
 */
function TagPicker({ ref, taxonomy, options, value, onChange, onCreate, disabled }: {
  ref?: React.Ref<HTMLButtonElement>; taxonomy: Taxonomy; options: TagOpt[]; value: AttrValue;
  onChange: (p: Partial<AttrValue>) => void; onCreate?: (name: string) => Promise<void>; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'tags' | 'priority' | 'version'>('tags');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const name = q.trim();
  const filtered = options.filter((o) => o.label.toLowerCase().includes(name.toLowerCase()));
  const exact = options.some((o) => o.label.toLowerCase() === name.toLowerCase());
  const vg = versionGroup(taxonomy);
  const versionName = vg?.tags.find((t) => t.id === value.versionTagId)?.name ?? '未歸類';
  const toggle = (o: TagOpt) => {
    if (value.tagIds.includes(o.id)) onChange({ tagIds: value.tagIds.filter((v) => v !== o.id) });
    else if (o.single && o.group) {
      const same = options.filter((x) => x.group === o.group).map((x) => x.id);
      onChange({ tagIds: [...value.tagIds.filter((v) => !same.includes(v)), o.id] });
    } else onChange({ tagIds: [...value.tagIds, o.id] });
  };
  const create = async () => {
    if (!name || exact || creating || !onCreate) return;
    setCreating(true);
    setError(null);
    try {
      await onCreate(name);
      setQ('');
    } catch (e) {
      setError(`${e instanceof ApiError && e.body.fieldErrors?.name ? '已有同名標籤，請直接選取或換個名稱。' : errorMessage(e)}名稱仍保留。`);
    } finally { setCreating(false); }
  };
  // a second-level list takes the focus; going back returns it to the entry that opened it
  const go = (next: typeof view) => {
    setView(next);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(next === 'tags' ? `[data-entry="${view}"]` : '[data-back]')?.focus());
  };
  const pick = (p: Partial<AttrValue>) => { onChange(p); setOpen(false); };
  const optionClass = 'flex min-h-9 w-full items-center gap-2 rounded-sm border-0 bg-transparent px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent';
  const check = (on: boolean) => <span className={cn('flex size-4 items-center justify-center', !on && 'invisible')}><CheckIcon className="size-4" aria-hidden="true" /></span>;
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(null); setView('tags'); } }}>
      <IconTip label="加入標籤、優先級或版本">
        <PopoverTrigger asChild disabled={disabled}>
          <button ref={ref} type="button" data-tag-add className="fbc-pill fbc-pill-add" aria-label={`加入標籤、優先級或版本${value.tagIds.length ? `（已選 ${value.tagIds.length} 個標籤）` : ''}`}
            onClick={(e) => e.stopPropagation()}><PlusIcon aria-hidden="true" /></button>
        </PopoverTrigger>
      </IconTip>
      <PopoverContent align="start" collisionPadding={16} className="w-[min(18rem,calc(100vw-2rem))] p-0" aria-label="加入標籤、優先級或版本"
        onClick={(e) => e.stopPropagation()}>
        <div ref={listRef}>
          {view === 'tags' ? (
            <>
              <div className="relative border-b border-border p-2">
                <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} maxLength={50} placeholder="搜尋或輸入新標籤" aria-label="搜尋或輸入新標籤" className="pl-8"
                  aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
                  onChange={(e) => { setQ(e.target.value); setError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!exact && name) void create(); else if (filtered[0]) toggle(filtered[0]); } }} />
              </div>
              <div className="max-h-60 overflow-y-auto p-1" role="group" aria-label="標籤">
                {filtered.map((o) => (
                  <button key={o.id} type="button" aria-pressed={value.tagIds.includes(o.id)} onClick={() => toggle(o)} className={optionClass}>
                    {check(value.tagIds.includes(o.id))}
                    <span className="min-w-0 truncate">{o.group ? <span className="text-muted-foreground">{o.group}：</span> : null}{o.label}</span>
                  </button>
                ))}
                {filtered.length === 0 && !name ? <p className="m-0 px-2 py-2 text-sm text-muted-foreground">這個產品尚無標籤，輸入名稱即可建立。</p> : null}
                {name && !exact && onCreate ? (
                  <button type="button" onClick={() => void create()} aria-disabled={creating || undefined} className={cn(optionClass, 'text-primary')}>
                    {creating ? <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> : <PlusIcon className="size-4" aria-hidden="true" />}
                    <span className="min-w-0 truncate">建立「{name}」並加入</span>
                  </button>
                ) : null}
              </div>
              {/* ATTR-02: priority and version, each a second-level list */}
              <div className="border-t border-border p-1" role="group" aria-label="其他屬性">
                <button type="button" data-entry="priority" className={optionClass} aria-haspopup="true" onClick={() => go('priority')}>
                  <FlagIcon className="size-4 text-muted-foreground" aria-hidden="true" /><span className="flex-1">優先級</span>
                  <span className="text-xs text-muted-foreground">{value.priority}</span><ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </button>
                {vg ? (
                  <button type="button" data-entry="version" className={optionClass} aria-haspopup="true" onClick={() => go('version')}>
                    <TagIcon className="size-4 text-muted-foreground" aria-hidden="true" /><span className="flex-1">版本</span>
                    <span className="max-w-24 truncate text-xs text-muted-foreground">{versionName}</span><ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 border-b border-border p-1">
                <button type="button" data-back className={cn(optionClass, 'w-auto pr-3')} onClick={() => go('tags')}>
                  <ChevronLeftIcon className="size-4" aria-hidden="true" />返回
                </button>
                <span className="text-sm font-medium">{view === 'priority' ? '優先級' : '版本'}</span>
              </div>
              <div className="max-h-60 overflow-y-auto p-1" role="group" aria-label={view === 'priority' ? '優先級' : '版本'}>
                {view === 'priority'
                  ? PRIORITIES.map((k) => (
                    <button key={k} type="button" aria-pressed={value.priority === k} className={optionClass} onClick={() => pick({ priority: k })}>
                      {check(value.priority === k)}<span>{PRIORITY_LABEL[k]}</span>
                    </button>
                  ))
                  : [{ id: '', name: '未歸類' }, ...(vg?.tags ?? [])].map((t) => (
                    <button key={t.id || 'none'} type="button" aria-pressed={(value.versionTagId ?? '') === t.id} className={optionClass} onClick={() => pick({ versionTagId: t.id || null })}>
                      {check((value.versionTagId ?? '') === t.id)}<span className="min-w-0 truncate">{t.name}</span>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
        {error ? <p id={errorId} role="alert" className="m-0 border-t border-border px-3 py-2 text-sm text-destructive">{error}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
