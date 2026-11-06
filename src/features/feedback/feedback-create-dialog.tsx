'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, CircleDotIcon, ImageIcon, LayoutGridIcon, LoaderCircleIcon, PlusIcon, RotateCwIcon, SearchIcon, UserRoundIcon, XIcon } from 'lucide-react';
import { api, ApiError, errorMessage, newKey } from '@/client/api';
import { useSite } from '@/client/site';
import { Avatar, useAnnouncer } from '@/components/ui';
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
import { tagOptions, type Feedback, type Taxonomy } from './types';
import { cn } from 'cn';

/**
 * 新增 Feedback (phase 2 UI/UX checklist FB01-FB09, IM01-IM06). Layout from the Figma Make reference
 * (STYLE_SPEC.md), mapped to Chainseabase tokens: title and description as borderless editors, an
 * image button with previews, the status / category / Person tag pills and the ＋ tag entry, the
 * author, then 新增多筆 with 取消 and 建立. Built on the shared shadcn Dialog (focus trap, Escape,
 * overlay, portal, focus return); the styles live in `.fbc-*` rules that only this dialog uses.
 *
 * Unchanged from before: the server defaults, validation, the idempotent create request (one key per
 * unchanged retry), 新增多筆 (keeps the classification, clears the text), the unsaved-input guard and
 * the confirmation before discarding. Fields not shown here keep their defaults: visibility 內部,
 * priority P0, no version (the same values the dialog always sent). They are edited in the detail view.
 */
const MAX_IMAGES = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface Form { title: string; description: string; statusId: string; categoryId: string; personTagIds: string[]; tagIds: string[] }

interface Upload {
  key: string;
  file: File;
  preview: string;
  state: 'uploading' | 'done' | 'error';
  serverId?: string;
  error?: string;
}

function defaults(t: Taxonomy): Form {
  return {
    title: '', description: '',
    statusId: t.statuses.find((s) => s.isDefault)?.id ?? t.statuses[0]?.id ?? '',
    categoryId: t.categories.find((c) => c.isDefault)?.id ?? t.categories[0]?.id ?? '',
    personTagIds: [], tagIds: [],
  };
}

export function CreateFeedbackDialog({ taxonomy, onClose, onChanged, onTaxonomyChanged }: { taxonomy: Taxonomy; onClose: () => void; onChanged: () => void; onTaxonomyChanged?: () => void }) {
  const { product } = useProduct();
  const { me } = useSite();
  const toast = useToast();
  const { announce, region } = useAnnouncer();
  const [form, setForm] = useState<Form>(() => defaults(taxonomy));
  // tags created from this dialog are not in the taxonomy the page loaded yet
  const [createdTags, setCreatedTags] = useState<{ id: string; label: string; group: null }[]>([]);
  const [revision, setRevision] = useState(taxonomy.productRevision);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [multi, setMulti] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const keyRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageButtonRef = useRef<HTMLButtonElement>(null);
  const ids = { title: useId(), titleError: useId(), desc: useId(), images: useId() };

  const dirty = form.title.trim() !== '' || form.description.trim() !== '' || uploads.length > 0;
  useUnsaved('feedback-create', dirty);
  const set = (p: Partial<Form>) => { keyRef.current = null; setForm((f) => ({ ...f, ...p })); };

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

  // object URLs of the previews are released with the dialog
  const uploadsRef = useRef(uploads);
  useEffect(() => { uploadsRef.current = uploads; }, [uploads]);
  useEffect(() => () => { for (const u of uploadsRef.current) URL.revokeObjectURL(u.preview); }, []);

  const P = `/products/${product.id}`;
  // a created tag also arrives in the taxonomy once the page reloads it: listed once
  const allTags = useMemo(() => [...new Map([...tagOptions(taxonomy).map((o) => ({ id: o.id, label: o.label, group: o.group as string | null, single: 'single' in o ? Boolean(o.single) : false })), ...createdTags.map((t) => ({ ...t, single: false }))].map((t) => [t.id, t] as const)).values()], [taxonomy, createdTags]);

  // ---------------- images (IM01-IM02, IM06) ----------------
  const upload = async (key: string, file: File) => {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, state: 'uploading', error: undefined } : u)));
    try {
      const r = await api.post<{ id: string }>(`${P}/feedback-images`, { rawBody: file, headers: { 'content-type': file.type } });
      keyRef.current = null;
      setUploads((list) => list.map((u) => (u.key === key ? { ...u, state: 'done', serverId: r.data.id } : u)));
    } catch (e) {
      setUploads((list) => list.map((u) => (u.key === key ? { ...u, state: 'error', error: errorMessage(e) } : u)));
    }
  };
  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const notes: string[] = [];
    const room = MAX_IMAGES - uploads.length;
    const picked = [...files];
    if (picked.length > room) notes.push(`每筆最多 ${MAX_IMAGES} 張圖片，已略過 ${picked.length - Math.max(room, 0)} 張。`);
    const accepted: Upload[] = [];
    for (const file of picked.slice(0, Math.max(room, 0))) {
      if (!TYPES.includes(file.type)) { notes.push(`「${file.name}」不是 JPEG、PNG 或 WebP。`); continue; }
      if (file.size > MAX_BYTES) { notes.push(`「${file.name}」超過 5 MB。`); continue; }
      accepted.push({ key: newKey(), file, preview: URL.createObjectURL(file), state: 'uploading' });
    }
    setImageNote(notes.length ? notes.join(' ') : null);
    if (!accepted.length) return;
    setUploads((list) => [...list, ...accepted]);
    for (const u of accepted) void upload(u.key, u.file);
    announce(`正在上傳 ${accepted.length} 張圖片`);
  };
  const removeUpload = (u: Upload) => {
    URL.revokeObjectURL(u.preview);
    setUploads((list) => list.filter((x) => x.key !== u.key));
    keyRef.current = null;
    // the uploaded (pending) file is deleted on the server; an unfinished upload expires by itself
    if (u.serverId) void api.del(`${P}/feedback-images/${u.serverId}`).catch(() => undefined);
    announce('已移除圖片');
    imageButtonRef.current?.focus();
  };
  const discardUploads = () => {
    for (const u of uploads) if (u.serverId) void api.del(`${P}/feedback-images/${u.serverId}`).catch(() => undefined);
  };

  // ---------------- submit (FB09) ----------------
  const uploading = uploads.some((u) => u.state === 'uploading');
  const failed = uploads.some((u) => u.state === 'error');
  const submit = async () => {
    if (pending) return;
    setTopError(null);
    if (!form.title.trim()) {
      setTitleError('標題不可空白');
      titleRef.current?.focus();
      return;
    }
    setTitleError(null);
    if (uploading) { setTopError('圖片仍在上傳，完成後即可建立。'); return; }
    if (failed) { setTopError('有圖片上傳失敗，請重試或移除後再建立。'); return; }
    // the same key is reused only when retrying an unchanged request
    keyRef.current ??= newKey();
    setPending(true);
    try {
      const versionless = form.tagIds;
      const r = await api.post<Feedback>(`${P}/feedback`, {
        key: keyRef.current,
        // the hidden fields keep the values this dialog always sent (FB08)
        body: {
          title: form.title, description: form.description, statusId: form.statusId, categoryId: form.categoryId,
          personTagIds: form.personTagIds, tagIds: versionless, priority: 'P0', versionTagId: null, visibility: 'internal',
          imageIds: uploads.map((u) => u.serverId!),
        },
      });
      keyRef.current = null;
      onChanged();
      toast('success', `已建立「${r.data.title}」`);
      if (multi) {
        // keep the classification, clear the text and the images (they now belong to the new Feedback)
        for (const u of uploads) URL.revokeObjectURL(u.preview);
        setUploads([]);
        setForm((f) => ({ ...f, title: '', description: '' }));
        announce(`已建立「${r.data.title}」，可繼續新增下一筆`);
        titleRef.current?.focus();
      } else {
        onClose();
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.body.fieldErrors?.title) setTitleError(err.body.fieldErrors.title);
      setTopError(`${errorMessage(e)}（已填寫的內容與圖片都保留）`);
    } finally {
      setPending(false);
    }
  };

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());
  const status = taxonomy.statuses.find((s) => s.id === form.statusId);
  const category = taxonomy.categories.find((c) => c.id === form.categoryId);
  const people = taxonomy.personTags.filter((t) => form.personTagIds.includes(t.id));
  const chosenTags = form.tagIds.map((id) => allTags.find((t) => t.id === id)).filter((t): t is (typeof allTags)[number] => Boolean(t));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="fbc-dialog flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(894px,calc(100%-2rem))]" onEscapeKeyDown={(e) => { if (dirty) { e.preventDefault(); setConfirmClose(true); } }}
        onInteractOutside={(e) => { if (dirty) { e.preventDefault(); setConfirmClose(true); } }}
        onOpenAutoFocus={(e) => { e.preventDefault(); titleRef.current?.focus(); }}>
        {region}
        <DialogHeader className="fbc-header gap-0 text-left">
          <DialogTitle className="fbc-heading">新增 Feedback</DialogTitle>
          <DialogDescription className="sr-only">輸入標題與描述，選擇屬性後建立。</DialogDescription>
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

          {/* FB05 / IM01-IM02: a real picker and upload, with previews */}
          <div className="fbc-images">
            {uploads.length ? (
              <ul className="fbc-previews" aria-label={`已選圖片，共 ${uploads.length} 張`}>
                {uploads.map((u, i) => (
                  <li key={u.key} className="fbc-preview" data-state={u.state}>
                    {/* local preview of the chosen file (object URL); the stored image is served by the API */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u.preview} alt={`圖片 ${i + 1}：${u.file.name}`} />
                    {u.state === 'uploading' ? <span className="fbc-preview-state" role="status"><LoaderCircleIcon className="animate-spin" aria-hidden="true" /><span className="sr-only">上傳中</span></span> : null}
                    {u.state === 'error' ? (
                      <span className="fbc-preview-state fbc-preview-error">
                        <button type="button" className="fbc-retry" onClick={() => void upload(u.key, u.file)} aria-label={`重試上傳圖片 ${i + 1}`}><RotateCwIcon aria-hidden="true" /></button>
                      </span>
                    ) : null}
                    <button type="button" className="fbc-preview-remove" onClick={() => removeUpload(u)} aria-label={`移除圖片 ${i + 1}`}><XIcon aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            ) : null}
            {uploads.filter((u) => u.state === 'error').map((u) => (
              <p key={u.key} className="fbc-image-error" role="alert">「{u.file.name}」上傳失敗：{u.error} 可重試或移除。</p>
            ))}
            {imageNote ? <p className="fbc-image-error" role="alert">{imageNote}</p> : null}
            {/* the picker itself is hidden: the labelled image button below opens it */}
            <input ref={fileRef} id={ids.images} type="file" accept={TYPES.join(',')} multiple hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <IconTip label="新增圖片">
              <button ref={imageButtonRef} type="button" className="fbc-image-button" aria-label={`新增圖片（JPEG、PNG、WebP，每張 5 MB 內，最多 ${MAX_IMAGES} 張）`}
                aria-disabled={uploads.length >= MAX_IMAGES || undefined}
                onClick={() => { if (uploads.length >= MAX_IMAGES) setImageNote(`每筆最多 ${MAX_IMAGES} 張圖片。`); else fileRef.current?.click(); }}>
                <ImageIcon aria-hidden="true" />
              </button>
            </IconTip>
          </div>

          {/* FB03/FB04/FB06: status, category, Person tag, then ＋ tag and the chosen tags; they wrap */}
          <div className="fbc-pills" role="group" aria-label="Feedback 屬性">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="fbc-pill fbc-pill-status" aria-label={`狀態：${status?.name ?? '未選擇'}`}>
                  <CircleDotIcon aria-hidden="true" /><span>{status?.name ?? '狀態'}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44">
                <DropdownMenuRadioGroup value={form.statusId} onValueChange={(v) => set({ statusId: v })}>
                  {taxonomy.statuses.map((s) => <DropdownMenuRadioItem key={s.id} value={s.id}>{s.name}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="fbc-pill fbc-pill-category" aria-label={`類別：${category?.name ?? '未選擇'}`}>
                  <LayoutGridIcon aria-hidden="true" /><span>{category?.name ?? '類別'}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44">
                <DropdownMenuRadioGroup value={form.categoryId} onValueChange={(v) => set({ categoryId: v })}>
                  {taxonomy.categories.map((c) => <DropdownMenuRadioItem key={c.id} value={c.id}>{c.name}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="fbc-pill" aria-label={`Person tag：${people.length ? people.map((t) => t.name).join('、') : '未安排'}`}>
                  <UserRoundIcon aria-hidden="true" /><span className="fbc-pill-text">{people.length ? people.map((t) => t.name).join('、') : '未安排'}</span><ChevronDownIcon className="fbc-chevron" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-48">
                <DropdownMenuCheckboxItem checked={form.personTagIds.length === 0} onSelect={(e) => e.preventDefault()} onCheckedChange={() => set({ personTagIds: [] })}>未安排</DropdownMenuCheckboxItem>
                {taxonomy.personTags.length ? <DropdownMenuSeparator /> : null}
                {taxonomy.personTags.map((t) => (
                  <DropdownMenuCheckboxItem key={t.id} checked={form.personTagIds.includes(t.id)} onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(c) => set({ personTagIds: c ? [...form.personTagIds, t.id] : form.personTagIds.filter((x) => x !== t.id) })}>{t.name}</DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <TagPicker options={allTags} value={form.tagIds} onChange={(v) => set({ tagIds: v })}
              onCreate={async (name) => {
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
                set({ tagIds: [...form.tagIds, r.data.tag.id] });
                // the page's own taxonomy (filters, detail view) learns about the new tag too
                onTaxonomyChanged?.();
                announce(`已建立並加入標籤「${r.data.tag.name}」`);
              }} />
            {chosenTags.map((t) => (
              <span key={t.id} className="fbc-pill fbc-tag">
                <span className="fbc-pill-text">{t.group ? `${t.group}：` : ''}{t.label}</span>
                {/* removing it here only takes it off this Feedback; the shared tag stays */}
                <button type="button" className="fbc-tag-remove" aria-label={`移除標籤「${t.label}」`} onClick={() => set({ tagIds: form.tagIds.filter((x) => x !== t.id) })}><XIcon aria-hidden="true" /></button>
              </span>
            ))}
          </div>

          {/* FB06: the real author; the creation time is recorded by the server when it is created */}
          <div className="fbc-author">
            <Avatar name={me?.displayName ?? ''} url={me?.avatarUrl} id={me?.id} size={20} />
            <span>{me?.displayName}</span><span aria-hidden="true">·</span><span>建立後記錄時間</span>
          </div>
        </div>

        <DialogFooter className="fbc-footer flex-row flex-wrap items-center justify-between gap-3 sm:justify-between">
          <label className="fbc-multi">
            <Switch checked={multi} onCheckedChange={setMulti} aria-label="新增多筆" />
            <span aria-hidden="true">新增多筆</span>
          </label>
          <div className="fbc-actions">
            <Button type="button" variant="outline" className="rounded-full" onClick={requestClose}>取消</Button>
            <Button type="button" className="rounded-full" onClick={submit} aria-disabled={pending || uploading || undefined} aria-busy={pending || undefined}>
              {pending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}建立
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>捨棄未建立的 Feedback？</AlertDialogTitle>
            <AlertDialogDescription>標題、描述與圖片都尚未送出，關閉後不會建立任何資料，也不會寄出通知；已上傳的圖片會一併刪除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>繼續編輯</AlertDialogCancel>
            <Button variant="destructive" onClick={() => { discardUploads(); setConfirmClose(false); onClose(); }}>捨棄</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/**
 * FB04: the ＋ entry. Search existing tags (a single-choice group keeps one), or create a new tag with
 * the typed name and add it to this Feedback. Errors keep the typed name.
 */
function TagPicker({ options, value, onChange, onCreate }: {
  options: { id: string; label: string; group: string | null; single: boolean }[];
  value: string[]; onChange: (ids: string[]) => void; onCreate: (name: string) => Promise<void>;
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
    if (!name || exact || creating) return;
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
        <PopoverTrigger asChild>
          <button type="button" className="fbc-pill fbc-pill-add" aria-label={`加入標籤${value.length ? `（已選 ${value.length} 個）` : ''}`}><PlusIcon aria-hidden="true" /></button>
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
          {name && !exact ? (
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
