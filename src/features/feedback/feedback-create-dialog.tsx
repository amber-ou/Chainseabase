'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ImageIcon, LoaderCircleIcon } from 'lucide-react';
import { api, ApiError, errorMessage, newKey } from '@/client/api';
import { useAnnouncer } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { IconTip } from '@/components/list-controls';
import { useToast } from '@/components/toast';
import { useProduct, useUnsaved } from '@/features/admin/shell';
import type { Feedback, Taxonomy } from './types';
import { MAX_IMAGES, IMAGE_TYPES, useImageUploads } from './image-uploads';
import { ImagePreviews } from './image-previews';
import { AttributePills, attrsOf, SaveStatus, VisibilityControl, type AttrValue, type SaveState } from './feedback-attributes';

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
 * DETAIL-03 (2026-11-10): the same form edits an existing Feedback (`edit`).
 *
 * ATTR-01..05 and the instant-save rules (2026-11-10, replacing the second settings row):
 * - Creating: priority and version come from ＋ (their pills appear left of it), 內部／公開 and 新增多筆
 *   sit at the left of the footer; everything is sent with 建立 (defaults unchanged: 內部, P0, no version).
 * - Editing: only the title, description and images are a draft sent with 儲存. Every attribute,
 *   公開範圍 included (footer left), is saved at once through the detail's saver (`live`), so 取消 never
 *   undoes them and 儲存 never sends them. 儲存 sends only the changed content with the latest revision;
 *   if someone else changed the content meanwhile, it says so and keeps the draft (saving over theirs
 *   needs an explicit second choice); if they changed only attributes, it is saved on the new revision.
 */
/** A Roadmap column's own option (RM-04), by ID: a status, a category, or a tag of a single-choice group. */
export interface CreateInitial { statusId?: string; categoryId?: string; tagId?: string }

/** An existing Feedback opened for editing: its content and images when the form opened (DETAIL-03). */
export interface EditTarget { feedback: Feedback; images: { id: string }[] }

/** The created Feedback as it is now, and the detail's instant attribute saver (shared with the detail). */
export interface LiveAttributes { feedback: Feedback; save: (p: Partial<AttrValue>) => Promise<boolean>; state: SaveState; saving: boolean }

interface Content { title: string; description: string }

function defaults(t: Taxonomy, initial?: CreateInitial): AttrValue {
  // a column's option is used only when it is a real option of this product; otherwise the usual default
  const status = initial?.statusId && t.statuses.some((s) => s.id === initial.statusId) ? initial.statusId : null;
  const category = initial?.categoryId && t.categories.some((c) => c.id === initial.categoryId) ? initial.categoryId : null;
  const group = initial?.tagId ? t.tagGroups.find((g) => g.tags.some((x) => x.id === initial.tagId)) : undefined;
  return {
    statusId: status ?? t.statuses.find((s) => s.isDefault)?.id ?? t.statuses[0]?.id ?? '',
    categoryId: category ?? t.categories.find((c) => c.isDefault)?.id ?? t.categories[0]?.id ?? '',
    personTagIds: [],
    // the version group is its own field (versionTagId); any other single-choice group is a tag
    tagIds: group && group.systemKey !== 'version' ? [initial!.tagId!] : [],
    versionTagId: group?.systemKey === 'version' ? initial!.tagId! : null,
    // the defaults creating always used (FB08)
    priority: 'P0', visibility: 'internal',
  };
}

export function CreateFeedbackDialog({ taxonomy, initial, onClose, onChanged, onTaxonomyChanged, edit, live, onSaved }: {
  taxonomy: Taxonomy; initial?: CreateInitial; onClose: () => void; onChanged: () => void; onTaxonomyChanged?: () => void;
  /** edit mode: the Feedback to update (DETAIL-03); onClose then means "back to the detail" */
  edit?: EditTarget; live?: LiveAttributes; onSaved?: (f: Feedback) => void;
}) {
  const { product } = useProduct();
  const toast = useToast();
  const { announce, region } = useAnnouncer();
  const P = `/products/${product.id}`;
  // the content the edit started from (attributes are live and not part of the draft)
  const [base] = useState<Content>(() => ({ title: edit?.feedback.title ?? '', description: edit?.feedback.description ?? '' }));
  const [baseImages, setBaseImages] = useState<string[]>(() => (edit?.images ?? []).map((i) => i.id));
  const [content, setContent] = useState<Content>(base);
  const [attrs, setAttrs] = useState<AttrValue>(() => defaults(taxonomy, initial));
  const [priorityChosen, setPriorityChosen] = useState(false);
  // tags created from this dialog are not in the taxonomy the page loaded yet
  const [createdTags, setCreatedTags] = useState<{ id: string; label: string; group: null }[]>([]);
  const [revision, setRevision] = useState(taxonomy.productRevision);
  const [multi, setMulti] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const keyRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageButtonRef = useRef<HTMLButtonElement>(null);
  const ids = { title: useId(), titleError: useId(), desc: useId(), images: useId() };
  const initialImages = useMemo(() => (edit?.images ?? []).map((img, i) => ({ id: img.id, name: `圖片 ${i + 1}`, preview: `/api/v1${P}/feedback/${edit!.feedback.id}/images/${img.id}/thumb` })), [edit, P]);
  const images = useImageUploads({ uploadPath: `${P}/feedback-images`, deletePath: (id) => `${P}/feedback-images/${id}`, initial: initialImages, onChange: () => { keyRef.current = null; } });
  const imagesChanged = edit ? JSON.stringify(images.ids) !== JSON.stringify(baseImages) || images.uploads.length !== images.ids.length : images.uploads.length > 0;

  const dirty = edit
    ? content.title !== base.title || content.description !== base.description || imagesChanged
    : content.title.trim() !== '' || content.description.trim() !== '' || images.uploads.length > 0;
  useUnsaved(edit ? `feedback-edit-${edit.feedback.id}` : 'feedback-create', dirty);
  const set = (p: Partial<Content>) => { keyRef.current = null; setTopError(null); setConflict(null); setContent((f) => ({ ...f, ...p })); };
  const setAttr = (p: Partial<AttrValue>) => {
    if (live) { void live.save(p); return; }
    keyRef.current = null;
    if (p.priority) setPriorityChosen(true);
    setAttrs((a) => ({ ...a, ...p }));
  };
  const shown = live ? attrsOf(live.feedback) : attrs;

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

  /** DETAIL-03: the changed content (never the attributes) of the same Feedback, at `rev`. */
  const saveContent = async (rev: number) => {
    const body: Record<string, unknown> = {};
    if (content.title !== base.title) body.title = content.title;
    if (content.description !== base.description) body.description = content.description;
    if (imagesChanged) body.imageIds = images.ids;
    if (Object.keys(body).length === 0) return null;
    return (await api.patch<Feedback>(`${P}/feedback/${edit!.feedback.id}`, { body: { ...body, expectedRevision: rev } })).data;
  };
  const finishEdit = (saved: Feedback | null) => {
    if (saved) { onChanged(); toast('success', '已儲存'); onSaved?.(saved); }
    else onClose();
  };

  // ---------------- submit (FB09; DETAIL-03 in edit mode) ----------------
  const submit = async (overwrite?: Feedback) => {
    if (pending) return;
    setTopError(null);
    if (!content.title.trim()) {
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
        // the latest revision this page knows (instant attribute saves move it on), or the one the
        // person chose to save over
        const rev = overwrite?.revision ?? live?.feedback.revision ?? edit.feedback.revision;
        try {
          finishEdit(await saveContent(rev));
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409)) throw e;
          const [server, serverImages] = await Promise.all([
            api.get<Feedback>(`${P}/feedback/${edit.feedback.id}`).then((r) => r.data),
            api.get<{ id: string }[]>(`${P}/feedback/${edit.feedback.id}/images`).then((r) => r.data.map((i) => i.id)),
          ]);
          const contentUntouched = server.title === base.title && server.description === base.description && JSON.stringify(serverImages) === JSON.stringify(baseImages);
          // only attributes changed meanwhile: the content goes onto the new revision without touching them
          if (contentUntouched) finishEdit(await saveContent(server.revision));
          else {
            setBaseImages(serverImages);
            setConflict(server);
            setTopError('標題、描述或圖片剛被其他人修改。你的內容仍保留在表單中，尚未儲存；可取消後重新開啟以查看對方的版本，或選擇以你的內容覆蓋。');
          }
        }
        return;
      }
      // the same key is reused only when retrying an unchanged request
      keyRef.current ??= newKey();
      const r = await api.post<Feedback>(`${P}/feedback`, {
        key: keyRef.current,
        body: {
          title: content.title, description: content.description, statusId: attrs.statusId, categoryId: attrs.categoryId,
          personTagIds: attrs.personTagIds, tagIds: attrs.tagIds, priority: attrs.priority, versionTagId: attrs.versionTagId, visibility: attrs.visibility,
          imageIds: images.ids,
        },
      });
      keyRef.current = null;
      onChanged();
      toast('success', `已建立「${r.data.title}」`);
      if (multi) {
        // keep the classification, clear the text and the images (they now belong to the new Feedback)
        images.clear();
        setContent({ title: '', description: '' });
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
  const verb = edit ? '儲存' : '建立';

  return (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="fbc-dialog flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(894px,calc(100%-2rem))]" onEscapeKeyDown={(e) => { if (dirty) { e.preventDefault(); setConfirmClose(true); } }}
        onInteractOutside={(e) => { if (dirty) { e.preventDefault(); setConfirmClose(true); } }}
        onOpenAutoFocus={(e) => { e.preventDefault(); titleRef.current?.focus(); }}>
        {region}
        <DialogHeader className="fbc-header gap-0 text-left">
          <DialogTitle className="fbc-heading">{edit ? '編輯 Feedback' : '新增 Feedback'}</DialogTitle>
          <DialogDescription className="sr-only">{edit ? '修改標題、描述與圖片後按儲存；屬性變更會立即儲存。' : '輸入標題與描述，選擇屬性後建立。'}</DialogDescription>
        </DialogHeader>

        <div className="fbc-body">
          {topError ? (
            <div className="banner banner-error fbc-banner" role="alert">
              {topError}
              {conflict ? <Button size="sm" variant="outline" className="ml-2" onClick={() => void submit(conflict)}>以我的內容覆蓋</Button> : null}
            </div>
          ) : null}
          {/* FB02: borderless editors; the hint is a placeholder, never a value; names for assistive tech */}
          <textarea ref={titleRef} id={ids.title} className="fbc-title" rows={1} maxLength={200} value={content.title} placeholder="請輸入標題"
            aria-label="標題" aria-required="true" aria-invalid={titleError ? true : undefined} aria-describedby={titleError ? ids.titleError : undefined}
            onChange={(e) => { set({ title: e.target.value.replace(/\n/g, ' ') }); if (titleError) setTitleError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) void submit(); } }} />
          {titleError ? <div id={ids.titleError} className="field-error fbc-field-error" role="alert">{titleError}</div> : null}
          <textarea id={ids.desc} className="fbc-description" maxLength={20000} value={content.description} placeholder="簡短描述建議或是Bug"
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

          {/* ATTR-01..03: one row; priority and version from ＋, their pills left of it */}
          <AttributePills taxonomy={taxonomy} value={shown} onChange={setAttr} extraTags={createdTags} announce={announce} onCreateTag={createTag}
            showPriority={Boolean(live) || priorityChosen} disabled={live?.saving} />
          {live ? <SaveStatus state={live.state} note="屬性變更會立即儲存；取消只放棄標題、描述與圖片的修改。" /> : null}
        </div>

        <DialogFooter className="fbc-footer flex-row flex-wrap items-center justify-between gap-3 sm:justify-between">
          {/* ATTR-04/05: 內部／公開 at the left (and 新增多筆 when creating); 取消 and the action at the right */}
          <div className="fbc-footer-start">
            <VisibilityControl value={shown.visibility} onChange={(v) => setAttr({ visibility: v })} disabled={live?.saving} />
            {edit ? null : (
              <label className="fbc-multi">
                <Switch checked={multi} onCheckedChange={setMulti} aria-label="新增多筆" />
                <span aria-hidden="true">新增多筆</span>
              </label>
            )}
          </div>
          <div className="fbc-actions">
            <Button type="button" variant="cancel" className="rounded-full" onClick={requestClose}>取消</Button>
            <Button type="button" className="rounded-full" onClick={() => void submit()} aria-disabled={pending || images.uploading || undefined} aria-busy={pending || undefined}>
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
              ? '標題、描述與圖片的修改尚未儲存，返回後維持原本內容；新上傳的圖片會一併刪除。已立即儲存的屬性不受影響。'
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
