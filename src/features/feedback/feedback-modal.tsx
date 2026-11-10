'use client';

import { useMemo, useState } from 'react';
import { api, ApiError, errorMessage } from '@/client/api';
import { useResource } from '@/client/hooks';
import { Button, ErrorState, Field, LoadingState, useAnnouncer } from '@/components/ui';
import { MultiSelect } from '@/components/multiselect';
import { IconLock } from '@/components/icons';
import { useToast } from '@/components/toast';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useProduct } from '@/features/admin/shell';
import { CreateFeedbackDialog, type CreateInitial, type EditTarget } from './feedback-create-dialog';
import { AttributePills, attrsOf, createProductTag, SaveStatus, useAttributeSaver, VisibilityNote } from './feedback-attributes';
import { adminCommentEndpoints, CommentThread } from './comments';
import { DetailDescription, DetailDialog, DetailImages } from './feedback-detail';
import type { Feedback, Taxonomy } from './types';

type Props =
  | { mode: 'create'; taxonomy: Taxonomy; onClose: () => void; onChanged: () => void; personal?: boolean; onTaxonomyChanged?: () => void; initial?: CreateInitial }
  | { mode: 'edit'; feedbackId: string; taxonomy: Taxonomy; onClose: () => void; onChanged: () => void; personal?: boolean; onTaxonomyChanged?: () => void };

export function FeedbackModal(props: Props) {
  // every create entry (Feedback, Roadmap, Personal) opens the same dialog (phase 2 FB09)
  if (props.mode === 'create') return <CreateFeedbackDialog taxonomy={props.taxonomy} initial={props.initial} onClose={props.onClose} onChanged={props.onChanged} onTaxonomyChanged={props.onTaxonomyChanged} />;
  return <AdminFeedbackDetail {...props} />;
}

interface ImageItem { id: string; width: number; height: number }

/**
 * The detail of a created Feedback on the admin site (follow-up batch 2026-11-10, DETAIL-01..06,
 * COMMENT-01..07, SCROLL-01..05): read-only title and description, images, the attribute pills (each
 * change is saved at once, with the Feedback's revision), ⋯ with 編輯 and 刪除, then the comments.
 * 編輯 switches to the shared Feedback form in edit mode, which updates this same Feedback.
 */
function AdminFeedbackDetail({ feedbackId, taxonomy, onClose, onChanged, personal, onTaxonomyChanged }: Extract<Props, { mode: 'edit' }>) {
  const { product } = useProduct();
  const toast = useToast();
  const { announce, region } = useAnnouncer();
  const P = `/products/${product.id}`;
  const res = useResource<Feedback>(`${P}/feedback/${feedbackId}`);
  const imgs = useResource<ImageItem[]>(`${P}/feedback/${feedbackId}/images`);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [banner, setBanner] = useState<{ kind: 'error' | 'conflict'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // instant-save rules: every attribute change is saved at once, here and in the edit form alike
  const saver = useAttributeSaver(`${P}/feedback/${feedbackId}`, res.data, (f) => res.setData(f), onChanged);
  const pills = useMemo(() => (res.data ? attrsOf(res.data) : null), [res.data]);

  if (res.loading || (!res.data && !res.error)) return <DetailDialog title="Feedback" onClose={onClose}><div className="fd-state"><LoadingState /></div></DetailDialog>;
  if (res.error || !res.data) {
    return (
      <DetailDialog title="Feedback" onClose={onClose}>
        <div className="fd-state">
          <ErrorState title={res.error?.isNotFound ? '找不到此 Feedback' : '讀取失敗'} message={res.error?.isNotFound ? '它可能已被移除，或不屬於目前的產品。' : res.error?.message} onRetry={res.error?.isNotFound ? undefined : res.reload} />
        </div>
      </DetailDialog>
    );
  }
  const fb = res.data;

  // DETAIL-03: the shared form, in edit mode; 取消 comes back here, 儲存 updates this Feedback
  if (editing) {
    return (
      <CreateFeedbackDialog taxonomy={taxonomy} edit={editing} live={{ feedback: fb, ...saver }} onChanged={onChanged} onTaxonomyChanged={onTaxonomyChanged}
        onClose={() => setEditing(null)}
        onSaved={(f) => { res.setData(f); void imgs.reload(); setEditing(null); }} />
    );
  }

  const remove = async () => {
    setDeleting(true);
    try {
      await api.del(`${P}/feedback/${fb.id}`, { ifMatch: fb.revision });
      toast('success', '已刪除 Feedback');
      onChanged();
      onClose();
    } catch (e) {
      setBanner({ kind: e instanceof ApiError && e.status === 409 ? 'conflict' : 'error', text: errorMessage(e) });
      setConfirmDelete(false);
    } finally { setDeleting(false); }
  };

  return (
    <>
      <DetailDialog title={fb.title} onClose={onClose}
        menu={[
          { label: '編輯', onSelect: () => setEditing({ feedback: fb, images: imgs.data ?? [] }) },
          { label: '刪除', danger: true, onSelect: () => setConfirmDelete(true) },
        ]}
        top={<>
          {region}
          {banner ? <div className={`banner ${banner.kind === 'error' ? 'banner-error' : ''} fd-banner`} role="alert">{banner.text}</div> : null}
          <DetailDescription text={fb.description} />
          <DetailImages images={imgs.data ?? []} url={(id, v) => `/api/v1${P}/feedback/${fb.id}/images/${id}/${v}`} />
          {/* DETAIL-06, instant-save rules: a change is saved at once to this Feedback */}
          {pills ? <AttributePills taxonomy={taxonomy} value={pills} onChange={(p) => void saver.save(p)} announce={announce} disabled={saver.saving}
            onCreateTag={async (name) => { const tag = await createProductTag(P, name); onTaxonomyChanged?.(); return tag; }} /> : null}
          {/* ATTR-06: visibility is shown read-only here; it is changed in the edit form */}
          {pills ? <VisibilityNote value={pills.visibility} /> : null}
          <SaveStatus state={saver.state} />
          {personal ? <PersonalTagsRow feedbackId={fb.id} /> : null}
        </>}>
        <CommentThread feedbackId={fb.id} isPublic={fb.visibility === 'public'} endpoints={adminCommentEndpoints(product.id, fb.id)}
          total={fb.commentCount} onCountChanged={() => { void res.reload(); onChanged(); }} />
      </DetailDialog>
      {/* DETAIL-02: deleting asks first and says what goes with it (the existing soft delete) */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除這筆 Feedback？</AlertDialogTitle>
            <AlertDialogDescription>
              「{fb.title}」會從列表、看板、Personal 與前台消失（保留稽核紀錄）。{fb.commentCount ? `它的 ${fb.commentCount} 則留言不會再顯示，` : ''}附加的圖片（含留言圖片）會一併刪除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button variant="danger" pending={deleting} onClick={() => void remove()}>刪除</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Third row: the signed-in member's own private tags (auto-saved, never shared). */
function PersonalTagsRow({ feedbackId }: { feedbackId: string }) {
  const { product } = useProduct();
  const mine = useResource<{ id: string; name: string }[]>(`/products/${product.id}/personal/tags`);
  const current = useResource<{ revision: number; tags: { id: string }[] }>(`/products/${product.id}/personal/feedback/${feedbackId}/tags`);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [newName, setNewName] = useState('');
  // adding a tag has its own state: its failure is not the "assignment reverted" message of the picker
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const save = async (ids: string[]) => {
    if (!current.data) return;
    setState('saving');
    try {
      const r = await api.put(`/products/${product.id}/personal/feedback/${feedbackId}/tags`, { body: { personalTagIds: ids, expectedRevision: current.data.revision } });
      current.setData(r.data);
      setState('saved');
    } catch {
      setState('error');
      void current.reload();
    }
  };
  return (
    <div className="fb-row fb-row-private fd-private" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
      <Field label={<span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><IconLock size={14} />個人 Tag（僅自己可見）</span>} hint={state === 'saving' ? '儲存中…' : state === 'saved' ? '已儲存' : state === 'error' ? '儲存失敗，已還原為最後確認的內容' : '自動儲存'}>{(p) => (
        mine.data && current.data ? (
          <MultiSelect id={p.id} label="個人 Tag" placeholder="未設定" options={mine.data.map((t) => ({ id: t.id, label: t.name }))} value={current.data.tags.map((t) => t.id)} onChange={save} />
        ) : <LoadingState />
      )}</Field>
      <form className="field" onSubmit={async (e) => {
        e.preventDefault();
        if (!newName.trim() || adding) return;
        setAdding(true);
        setAddError(null);
        try {
          await api.post(`/products/${product.id}/personal/tags`, { body: { name: newName.trim() } });
          setNewName('');
          void mine.reload();
        } catch (er) {
          // the typed name stays, so it can be corrected and sent again
          setAddError(`${errorMessage(er)}名稱仍保留，可修改後再新增。`);
        } finally { setAdding(false); }
      }}>
        <label className="field-label" htmlFor="new-personal-tag">新增個人 Tag</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input id="new-personal-tag" className="input" maxLength={50} value={newName} onChange={(e) => setNewName(e.target.value)}
            aria-invalid={addError ? true : undefined} aria-describedby={addError ? 'new-personal-tag-error' : undefined} />
          <Button type="submit" size="sm" pending={adding} disabled={!newName.trim()}>新增</Button>
        </div>
        {addError ? <span id="new-personal-tag-error" className="field-error" role="alert">{addError}</span> : null}
      </form>
    </div>
  );
}
