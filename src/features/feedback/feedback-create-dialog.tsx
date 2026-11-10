'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, CircleDotIcon, FlagIcon, GlobeIcon, ImageIcon, LayoutGridIcon, LoaderCircleIcon, LockIcon, PlusIcon, SearchIcon, TagIcon, UserRoundIcon } from 'lucide-react';
import { api, ApiError, errorMessage, newKey } from '@/client/api';
import { PRIORITY_LABEL } from '@/client/format';
import { useAnnouncer } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { IconTip } from '@/components/list-controls';
import { useToast } from '@/components/toast';
import { useProduct, useUnsaved } from '@/features/admin/shell';
import { tagOptions, versionGroup, type Feedback, type Taxonomy } from './types';
import { MAX_IMAGES, IMAGE_TYPES, useImageUploads } from './image-uploads';
import { ImagePreviews } from './image-previews';
import { cn } from 'cn';

/**
 * 新增 Feedback (phase 2 UI/UX checklist FB01-FB09, IM01-IM06). Layout from the Figma Make reference
 * (STYLE_SPEC.md), mapped to Chainseabase tokens: title and description as borderless editors, an
 * image button with previews, the status / category / Person tag pills, the chosen tags and the ＋ tag
 * entry (phase 3: no author row), then 新增多筆 with 取消 and 建立. Built on the shared shadcn Dialog (focus trap, Escape,
 * overlay, portal, focus return); the styles live in `.fbc-*` rules that only this dialog uses.
 *
 * Unchanged from before: the server defaults, validation, the idempotent create request (one key per
 * unchanged retry), 新增多筆 (keeps the classification, clears the text), the unsaved-input guard and
 * the confirmation before discarding. Fields not shown here keep their defaults: visibility 內部,
 * priority P0, no version (the same values the dialog always sent).
 *
 * DETAIL-03/04 (2026-11-10): the same form edits an existing Feedback (`edit`). It starts from the
 * Feedback's title, description, attributes and images, adds the 優先級 / 版本 / 公開範圍 settings that
 * creating leaves at their defaults, and 儲存 sends only what changed to the same Feedback (PATCH with its
 * revision; a conflict keeps the input). 取消 returns to the detail; nothing is created.
 */
type Priority = Feedback['priority'];
interface Form {
  title: string; description: string; statusId: string; categoryId: string; personTagIds: string[]; tagIds: string[]; versionTagId: string | null;
  priority: Priority; visibility: Feedback['visibility'];
}
/** The attributes shown as pills (status, category, Person tag, chosen tags). */
export type PillValue = Pick<Form, 'statusId' | 'categoryId' | 'personTagIds' | 'tagIds' | 'versionTagId'>;

/** A Roadmap column's own option (RM-04), by ID: a status, a category, or a tag of a single-choice group. */
export interface CreateInitial { statusId?: string; categoryId?: string; tagId?: string }

/** An existing Feedback opened for editing, with its images (DETAIL-03). */
export interface EditTarget { feedback: Feedback; images: { id: string }[] }

function defaults(t: Taxonomy, initial?: CreateInitial): Form {
  // a column's option is used only when it is a real option of this product; otherwise the usual default
  const status = initial?.statusId && t.statuses.some((s) => s.id === initial.statusId) ? initial.statusId : null;
  const category = initial?.categoryId && t.categories.some((c) => c.id === initial.categoryId) ? initial.categoryId : null;
  const group = initial?.tagId ? t.tagGroups.find((g) => g.tags.some((x) => x.id === initial.tagId)) : undefined;
  return {
    title: '', description: '',
    statusId: status ?? t.statuses.find((s) => s.isDefault)?.id ?? t.statuses[0]?.id ?? '',
    categoryId: category ?? t.categories.find((c) => c.isDefault)?.id ?? t.categories[0]?.id ?? '',
    personTagIds: [],
    // the version group is its own field (versionTagId); any other single-choice group is a tag
    tagIds: group && group.systemKey !== 'version' ? [initial!.tagId!] : [],
    versionTagId: group?.systemKey === 'version' ? initial!.tagId! : null,
    // creating keeps the values this dialog always sent (FB08)
    priority: 'P0', visibility: 'internal',
  };
}

export function fromFeedback(f: Feedback): Form {
  return {
    title: f.title, description: f.description, statusId: f.status.id, categoryId: f.category.id,
    personTagIds: f.personTags.map((p) => p.id), tagIds: f.tags.filter((t) => !t.isVersion).map((t) => t.id),
    versionTagId: f.version?.id ?? null, priority: f.priority, visibility: f.visibility,
  };
}

export function CreateFeedbackDialog({ taxonomy, initial, onClose, onChanged, onTaxonomyChanged, edit, onSaved }: {
  taxonomy: Taxonomy; initial?: CreateInitial; onClose: () => void; onChanged: () => void; onTaxonomyChanged?: () => void;
  /** edit mode: the Feedback to update (DETAIL-03); onClose then means "back to the detail" */
  edit?: EditTarget; onSaved?: (f: Feedback) => void;
}) {
  const { product } = useProduct();
  const toast = useToast();
  const { announce, region } = useAnnouncer();
  const P = `/products/${product.id}`;
  const base = useMemo(() => (edit ? fromFeedback(edit.feedback) : defaults(taxonomy, initial)), [edit, taxonomy, initial]);
  const [form, setForm] = useState<Form>(base);
  // tags created from this dialog are not in the taxonomy the page loaded yet
  const [createdTags, setCreatedTags] = useState<{ id: string; label: string; group: null }[]>([]);
  const [revision, setRevision] = useState(taxonomy.productRevision);
  const [multi, setMulti] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const keyRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageButtonRef = useRef<HTMLButtonElement>(null);
  const ids = { title: useId(), titleError: useId(), desc: useId(), images: useId() };
  const initialImages = useMemo(() => (edit?.images ?? []).map((img, i) => ({ id: img.id, name: `圖片 ${i + 1}`, preview: `/api/v1${P}/feedback/${edit!.feedback.id}/images/${img.id}/thumb` })), [edit, P]);
  const images = useImageUploads({ uploadPath: `${P}/feedback-images`, deletePath: (id) => `${P}/feedback-images/${id}`, initial: initialImages, onChange: () => { keyRef.current = null; } });
  const imagesChanged = edit ? JSON.stringify(images.ids) !== JSON.stringify(edit.images.map((i) => i.id)) || images.uploads.length !== images.ids.length : images.uploads.length > 0;

  const dirty = edit
    ? JSON.stringify(form) !== JSON.stringify(base) || imagesChanged
    : form.title.trim() !== '' || form.description.trim() !== '' || images.uploads.length > 0;
  useUnsaved(edit ? `feedback-edit-${edit.feedback.id}` : 'feedback-create', dirty);
  const set = (p: Partial<Form>) => { keyRef.current = null; setTopError(null); setForm((f) => ({ ...f, ...p })); };

  // focus goes back to whatever opened the dialog (it is unmounted, not closed, by its parent)
  // read during the first render, before the dialog moves focus inside
  const [opener] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  useEffect(() => {
    return () => {
      setTimeout(() => {
        if (opener?.isConnected && (document.activeElement === document.body || !document.activeElement)) opener.focus();
      }, 0);
    };
  }, [opener]);


  const createTag = async (name: string) => {
    // a newly created tag is ungrouped, in this product (the same rules as Setting)
    const create = (rev: number) => api.post<{ tag: { id: string; name: string }; productRevision: number }>(`${P}/tags`, { body: { name, groupId: null, expectedRevision: rev } });
    let r;
    try { r = await create(revision); } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) throw e;
      // the product's settings changed meanwhile: read the current revision and try once more
      const t = await api.get<Taxonomy>(`${P}/taxonomy`);
      r = await create(t.data.productRevision);
    }
    setRevision(r.data.productRevision);
    setCreatedTags((list) => [...list, { id: r.data.tag.id, label: r.data.tag.name, group: null }]);
    // the page's own taxonomy (filters, detail view) learns about the new tag too
    onTaxonomyChanged?.();
    return { id: r.data.tag.id, name: r.data.tag.name };
  };

  // ---------------- submit (FB09; DETAIL-03 in edit mode) ----------------
  const submit = async () => {
    if (pending) return;
    setTopError(null);
    if (!form.title.trim()) {
      setTitleError('標題不可空白');
      titleRef.current?.focus();
      return;
    }
    setTitleError(null);
    if (images.uploading) { setTopError(`圖片仍在上傳，完成後即可${edit ? '儲存' : '建立'}。`); return; }
    if (images.failed) { setTopError(`有圖片上傳失敗，請重試或移除後再${edit ? '儲存' : '建立'}。`); return; }
    setPending(true);
    try {
      if (edit) {
        // only what changed is sent, to the same Feedback, with the revision it was opened at
        const patch: Record<string, unknown> = {};
        (Object.keys(form) as (keyof Form)[]).forEach((k) => { if (JSON.stringify(form[k]) !== JSON.stringify(base[k])) patch[k] = form[k]; });
        if ('tagIds' in patch && !('versionTagId' in patch)) patch.versionTagId = form.versionTagId;
        if (imagesChanged) patch.imageIds = images.ids;
        if (Object.keys(patch).length === 0) { onClose(); return; }
        const r = await api.patch<Feedback>(`${P}/feedback/${edit.feedback.id}`, { body: { ...patch, expectedRevision: edit.feedback.revision } });
        onChanged();
        toast('success', '已儲存');
        onSaved?.(r.data);
        return;
      }
      // the same key is reused only when retrying an unchanged request
      keyRef.current ??= newKey();
      const r = await api.post<Feedback>(`${P}/feedback`, {
        key: keyRef.current,
        // the hidden fields keep the values this dialog always sent (FB08)
        body: {
          title: form.title, description: form.description, statusId: form.statusId, categoryId: form.categoryId,
          personTagIds: form.personTagIds, tagIds: form.tagIds, priority: 'P0', versionTagId: form.versionTagId, visibility: 'internal',
          imageIds: images.ids,
        },
      });
      keyRef.current = null;
      onChanged();
      toast('success', `已建立「${r.data.title}」`);
      if (multi) {
        // keep the classification, clear the text and the images (they now belong to the new Feedback)
        images.clear();
        setForm((f) => ({ ...f, title: '', description: '' }));
        announce(`已建立「${r.data.title}」，可繼續新增下一筆`);
        titleRef.current?.focus();
      } else {
        onClose();
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.body.fieldErrors?.title) setTitleError(err.body.fieldErrors.title);
      if (edit && err?.status === 409) setTopError('內容已被其他人更新。你的修改仍保留在表單中；可取消後重新開啟以載入最新內容。');
      else setTopError(`${errorMessage(e)}（已填寫的內容與圖片都保留）`);
    } finally {
      setPending(false);
    }
  };

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());
  const verb = edit ? '儲存' : '建立';

  return (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="fbc-dialog flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(894px,calc(100%-2rem))]" onEscapeKeyDown={(e) => { if (dirty) { e.preventDefault(); setConfirmClose(true); } }}
        onInteractOutside={(e) => { if (dirty) { e.preventDefault(); setConfirmClose(true); } }}
        onOpenAutoFocus={(e) => { e.preventDefault(); titleRef.current?.focus(); }}>
        {region}
        <DialogHeader className="fbc-header gap-0 text-left">
          <DialogTitle className="fbc-heading">{edit ? '編輯 Feedback' : '新增 Feedback'}</DialogTitle>
          <DialogDescription className="sr-only">{edit ? '修改標題、描述、圖片與屬性後儲存；會更新原本這筆 Feedback。' : '輸入標題與描述，選擇屬性後建立。'}</DialogDescription>
        </DialogHeader>

        <div className="fbc-body">
          {topError ? <div className="banner banner-error fbc-banner" role="alert">{topError}</div> : null}
          {/* FB02: borderless editors; the hint is a placeholder, never a value; names for assistive tech */}
          <textarea ref={titleRef} id={ids.title} className="fbc-title" rows={1} maxLength={200} value={form.title} placeholder="請輸入標題"
            aria-label="標題" aria-required="true" aria-invalid={titleError ? true : undefined} aria-describedby={titleError ? ids.titleError : undefined}
            onChange={(e) => { set({ title: e.target.value.replace(/\n/g, ' ') }); if (titleError) setTitleError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) void submit(); } }} />
          {titleError ? <div id={ids.titleError} className="field-error fbc-field-error" role="alert">{titleError}</div> : null}
          <textarea id={ids.desc} className="fbc-description" maxLength={20000} value={form.description} placeholder="簡短描述建議或是Bug"
            aria-label="描述" onChange={(e) => set({ description: e.target.value })} />

          {/* FB05 / IM01-IM02: a real picker and upload, with previews; in edit mode the current images first */}
          <div className="fbc-images">
            <ImagePreviews uploads={images.uploads} note={images.note} onRetry={images.retry}
              onRemove={(u) => { images.remove(u); announce('已移除圖片'); imageButtonRef.current?.focus(); }} />
            {/* the picker itself is hidden: the labelled image button below opens it */}
            <input ref={fileRef} id={ids.images} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden
              onChange={(e) => { const n = images.addFiles(e.target.files); if (n) announce(`正在上傳 ${n} 張圖片`); e.target.value = ''; }} />
            <IconTip label="新增圖片">
              <button ref={imageButtonRef} type="button" className="fbc-image-button" aria-label={`新增圖片（JPEG、PNG、WebP，每張 5 MB 內，最多 ${MAX_IMAGES} 張）`}
                aria-disabled={images.full || undefined}
                onClick={() => { if (images.full) images.setNote(`每筆最多 ${MAX_IMAGES} 張圖片。`); else fileRef.current?.click(); }}>
                <ImageIcon aria-hidden="true" />
              </button>
            </IconTip>
          </div>

          <AttributePills taxonomy={taxonomy} value={form} onChange={set} extraTags={createdTags} announce={announce} onCreateTag={createTag} />
          {/* DETAIL-04: the settings creating leaves at their defaults are edited here */}
          {edit ? <SettingsPills taxonomy={taxonomy} value={form} onChange={set} /> : null}
        </div>

        <DialogFooter className="fbc-footer flex-row flex-wrap items-center justify-between gap-3 sm:justify-between">
          {edit ? <span /> : (
            <label className="fbc-multi">
              <Switch checked={multi} onCheckedChange={setMulti} aria-label="新增多筆" />
              <span aria-hidden="true">新增多筆</span>
            </label>
          )}
          <div className="fbc-actions">
            <Button type="button" variant="cancel" className="rounded-full" onClick={requestClose}>取消</Button>
            <Button type="button" className="rounded-full" onClick={submit} aria-disabled={pending || images.uploading || undefined} aria-busy={pending || undefined}>
              {pending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}{verb}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{edit ? '放棄未儲存的修改？' : '捨棄未建立的 Feedback？'}</AlertDialogTitle>
            <AlertDialogDescription>{edit
              ? '修改尚未儲存，返回後這筆 Feedback 維持原本內容；新上傳的圖片會一併刪除。'
              : '標題、描述與圖片都尚未送出，關閉後不會建立任何資料，也不會寄出通知；已上傳的圖片會一併刪除。'}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>繼續編輯</AlertDialogCancel>
            <Button variant="destructive" onClick={() => { images.discard(); setConfirmClose(false); onClose(); }}>{edit ? '放棄修改' : '捨棄'}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/**
 * FB03/FB04/FB06, DETAIL-06: status, category, Person tag, the chosen tags, then ＋ (always last).
 * Shared by the form and the detail view (where each change is saved at once). Clicking a chosen tag
 * (Enter / Space too) takes it off this Feedback; the shared tag stays.
 */
export function AttributePills({ taxonomy, value, onChange, extraTags = [], announce, onCreateTag, disabled }: {
  taxonomy: Taxonomy; value: PillValue; onChange: (p: Partial<PillValue>) => void;
  extraTags?: { id: string; label: string; group: null }[]; announce: (m: string) => void;
  onCreateTag?: (name: string) => Promise<{ id: string; name: string }>; disabled?: boolean;
}) {
  const allTags = useMemo(() => [...new Map([...tagOptions(taxonomy).map((o) => ({ id: o.id, label: o.label, group: o.group as string | null, single: 'single' in o ? Boolean(o.single) : false })), ...extraTags.map((t) => ({ ...t, single: false }))].map((t) => [t.id, t] as const)).values()], [taxonomy, extraTags]);
  const status = taxonomy.statuses.find((s) => s.id === value.statusId);
  const category = taxonomy.categories.find((c) => c.id === value.categoryId);
  const people = taxonomy.personTags.filter((t) => value.personTagIds.includes(t.id));
  const chosenTags = value.tagIds.map((id) => allTags.find((t) => t.id === id)).filter((t): t is (typeof allTags)[number] => Boolean(t));
  const version = value.versionTagId ? versionGroup(taxonomy)?.tags.find((x) => x.id === value.versionTagId) : undefined;
  const toAdd = () => requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-tag-add]')?.focus());
  return (
    <div className="fbc-pills" role="group" aria-label="Feedback 屬性" aria-disabled={disabled || undefined}>
      <DropdownMenu>
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button type="button" className="fbc-pill fbc-pill-category" aria-label={`類別：${category?.name ?? '未選擇'}`}>
            <LayoutGridIcon aria-hidden="true" /><span className="fbc-pill-text">{category?.name ?? '類別'}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <DropdownMenuRadioGroup value={value.categoryId} onValueChange={(v) => onChange({ categoryId: v })}>
            {taxonomy.categories.map((c) => <DropdownMenuRadioItem key={c.id} value={c.id}>{c.name}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button type="button" className="fbc-pill" aria-label={`Person tag：${people.length ? people.map((t) => t.name).join('、') : '未安排'}`}>
            <UserRoundIcon aria-hidden="true" /><span className="fbc-pill-text">{people.length ? people.map((t) => t.name).join('、') : '未安排'}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          <DropdownMenuCheckboxItem checked={value.personTagIds.length === 0} onSelect={(e) => e.preventDefault()} onCheckedChange={() => onChange({ personTagIds: [] })}>未安排</DropdownMenuCheckboxItem>
          {taxonomy.personTags.length ? <DropdownMenuSeparator /> : null}
          {taxonomy.personTags.map((t) => (
            <DropdownMenuCheckboxItem key={t.id} checked={value.personTagIds.includes(t.id)} onSelect={(e) => e.preventDefault()}
              onCheckedChange={(c) => onChange({ personTagIds: c ? [...value.personTagIds, t.id] : value.personTagIds.filter((x) => x !== t.id) })}>{t.name}</DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* III-04: the chosen tags come before ＋, which stays last when the row wraps */}
      {version ? (
        <button type="button" className="fbc-pill fbc-tag" aria-label={`取消選取：版本 ${version.name}`} disabled={disabled}
          onClick={() => { onChange({ versionTagId: null }); announce(`已取消選取版本「${version.name}」`); toAdd(); }}>
          <span className="fbc-pill-text">版本：{version.name}</span>
        </button>
      ) : null}
      {chosenTags.map((t) => (
        <button key={t.id} type="button" className="fbc-pill fbc-tag" aria-label={`取消選取：${t.label}`} disabled={disabled}
          onClick={() => {
            onChange({ tagIds: value.tagIds.filter((x) => x !== t.id) });
            announce(`已取消選取標籤「${t.label}」`);
            // the pill is gone: focus moves on to ＋ instead of falling to the page
            toAdd();
          }}>
          <span className="fbc-pill-text">{t.group ? `${t.group}：` : ''}{t.label}</span>
        </button>
      ))}
      <TagPicker options={allTags} value={value.tagIds} disabled={disabled} onChange={(v) => onChange({ tagIds: v })}
        onCreate={onCreateTag ? async (name) => {
          const tag = await onCreateTag(name);
          onChange({ tagIds: [...value.tagIds, tag.id] });
          announce(`已建立並加入標籤「${tag.name}」`);
        } : undefined} />
    </div>
  );
}

/** DETAIL-04: priority, version and visibility, kept in the edit form (creating leaves the defaults). */
function SettingsPills({ taxonomy, value, onChange }: { taxonomy: Taxonomy; value: Pick<Form, 'priority' | 'versionTagId' | 'visibility'>; onChange: (p: Partial<Form>) => void }) {
  const vg = versionGroup(taxonomy);
  const version = vg?.tags.find((t) => t.id === value.versionTagId);
  return (
    <div className="fbc-pills fbc-settings" role="group" aria-label="其他設定">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="fbc-pill" aria-label={`優先級：${PRIORITY_LABEL[value.priority]}`}>
            <FlagIcon aria-hidden="true" /><span className="fbc-pill-text">{PRIORITY_LABEL[value.priority]}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <DropdownMenuRadioGroup value={value.priority} onValueChange={(v) => onChange({ priority: v as Priority })}>
            {(['P0', 'P1', 'P2', 'P3'] as const).map((k) => <DropdownMenuRadioItem key={k} value={k}>{PRIORITY_LABEL[k]}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {vg ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="fbc-pill" aria-label={`版本：${version?.name ?? '未歸類'}`}>
              <TagIcon aria-hidden="true" /><span className="fbc-pill-text">版本：{version?.name ?? '未歸類'}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuRadioGroup value={value.versionTagId ?? ''} onValueChange={(v) => onChange({ versionTagId: v || null })}>
              <DropdownMenuRadioItem value="">未歸類</DropdownMenuRadioItem>
              {vg.tags.map((t) => <DropdownMenuRadioItem key={t.id} value={t.id}>{t.name}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="fbc-pill" aria-label={`公開範圍：${value.visibility === 'public' ? '公開' : '內部'}`}>
            {value.visibility === 'public' ? <GlobeIcon aria-hidden="true" /> : <LockIcon aria-hidden="true" />}
            <span className="fbc-pill-text">{value.visibility === 'public' ? '公開' : '內部'}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuRadioGroup value={value.visibility} onValueChange={(v) => onChange({ visibility: v as Form['visibility'] })}>
            <DropdownMenuRadioItem value="internal">內部：只有團隊後台可見</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="public">公開：前台可看到標題、描述、狀態與一般留言</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * FB04: the ＋ entry. Search existing tags (a single-choice group keeps one), or create a new tag with
 * the typed name and add it to this Feedback. Errors keep the typed name.
 */
function TagPicker({ options, value, onChange, onCreate, disabled }: {
  options: { id: string; label: string; group: string | null; single: boolean }[];
  value: string[]; onChange: (ids: string[]) => void; onCreate?: (name: string) => Promise<void>; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const name = q.trim();
  const filtered = options.filter((o) => o.label.toLowerCase().includes(name.toLowerCase()));
  const exact = options.some((o) => o.label.toLowerCase() === name.toLowerCase());
  const toggle = (o: (typeof options)[number]) => {
    if (value.includes(o.id)) onChange(value.filter((v) => v !== o.id));
    else if (o.single && o.group) {
      const same = options.filter((x) => x.group === o.group).map((x) => x.id);
      onChange([...value.filter((v) => !same.includes(v)), o.id]);
    } else onChange([...value, o.id]);
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
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <IconTip label="加入標籤">
        <PopoverTrigger asChild disabled={disabled}>
          <button type="button" data-tag-add className="fbc-pill fbc-pill-add" aria-label={`加入標籤${value.length ? `（已選 ${value.length} 個）` : ''}`}><PlusIcon aria-hidden="true" /></button>
        </PopoverTrigger>
      </IconTip>
      <PopoverContent align="start" collisionPadding={16} className="w-[min(18rem,calc(100vw-2rem))] p-0" aria-label="加入標籤">
        <div className="relative border-b border-border p-2">
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} maxLength={50} placeholder="搜尋或輸入新標籤" aria-label="搜尋或輸入新標籤" className="pl-8"
            aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
            onChange={(e) => { setQ(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!exact && name) void create(); else if (filtered[0]) toggle(filtered[0]); } }} />
        </div>
        <div className="max-h-60 overflow-y-auto p-1" role="group" aria-label="標籤">
          {filtered.map((o) => (
            <button key={o.id} type="button" aria-pressed={value.includes(o.id)} onClick={() => toggle(o)}
              className="flex min-h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent">
              <span className={cn('flex size-4 items-center justify-center', !value.includes(o.id) && 'invisible')}><CheckIcon className="size-4" aria-hidden="true" /></span>
              <span className="min-w-0 truncate">{o.group ? <span className="text-muted-foreground">{o.group}：</span> : null}{o.label}</span>
            </button>
          ))}
          {filtered.length === 0 && !name ? <p className="m-0 px-2 py-2 text-sm text-muted-foreground">這個產品尚無標籤，輸入名稱即可建立。</p> : null}
          {name && !exact && onCreate ? (
            <button type="button" onClick={() => void create()} aria-disabled={creating || undefined}
              className="flex min-h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-primary outline-none hover:bg-accent focus-visible:bg-accent">
              {creating ? <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> : <PlusIcon className="size-4" aria-hidden="true" />}
              <span className="min-w-0 truncate">建立「{name}」並加入</span>
            </button>
          ) : null}
        </div>
        {error ? <p id={errorId} role="alert" className="m-0 border-t border-border px-3 py-2 text-sm text-destructive">{error}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
