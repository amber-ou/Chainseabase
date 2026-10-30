'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, errorMessage, newKey } from '@/client/api';
import { useResource } from '@/client/hooks';
import { useSite } from '@/client/site';
import { formatDateTime, PRIORITY_LABEL } from '@/client/format';
import { Avatar, Button, ErrorState, Field, LoadingState, Switch, useAnnouncer } from '@/components/ui';
import { ConfirmModal, Modal } from '@/components/modal';
import { Tabs } from '@/components/tabs';
import { MultiSelect } from '@/components/multiselect';
import { IconCheck, IconLock } from '@/components/icons';
import { useToast } from '@/components/toast';
import { useProduct, useUnsaved } from '@/features/admin/shell';
import { emptyDraft, type DraftState } from '@/modules/schedule/draft';
import { ScheduleDraftTab, ScheduleLiveTab } from '@/features/schedule/schedule-tab';
import { CommentThread } from './comments';
import { tagOptions, versionGroup, type Feedback, type Taxonomy } from './types';

interface FormState {
  title: string;
  description: string;
  statusId: string;
  categoryId: string;
  personTagIds: string[];
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  versionTagId: string | null;
  tagIds: string[];
  visibility: 'internal' | 'public';
}

function defaults(t: Taxonomy): FormState {
  return {
    title: '', description: '',
    statusId: t.statuses.find((s) => s.isDefault)?.id ?? t.statuses[0]?.id ?? '',
    categoryId: t.categories.find((c) => c.isDefault)?.id ?? t.categories[0]?.id ?? '',
    personTagIds: [], priority: 'P0', versionTagId: null, tagIds: [], visibility: 'internal',
  };
}

function fromFeedback(f: Feedback): FormState {
  return {
    title: f.title, description: f.description, statusId: f.status.id, categoryId: f.category.id,
    personTagIds: f.personTags.map((p) => p.id), priority: f.priority, versionTagId: f.version?.id ?? null,
    tagIds: f.tags.filter((t) => !t.isVersion).map((t) => t.id), visibility: f.visibility,
  };
}

type Props =
  | { mode: 'create'; taxonomy: Taxonomy; onClose: () => void; onChanged: () => void; personal?: boolean }
  | { mode: 'edit'; feedbackId: string; taxonomy: Taxonomy; onClose: () => void; onChanged: () => void; personal?: boolean };

export function FeedbackModal(props: Props) {
  if (props.mode === 'create') return <CreateFeedback {...props} />;
  return <EditFeedback {...props} />;
}

function ClassificationRows({ form, set, tax, personal, feedbackId }: { form: FormState; set: (p: Partial<FormState>) => void; tax: Taxonomy; personal?: boolean; feedbackId?: string }) {
  const vg = versionGroup(tax);
  return (
    <div className="fb-rows">
      <div className="fb-row">
        <Field label="狀態">{(p) => (
          <select {...p} className="select" value={form.statusId} onChange={(e) => set({ statusId: e.target.value })}>
            {tax.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}</Field>
        <Field label="類別">{(p) => (
          <select {...p} className="select" value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            {tax.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}</Field>
        <Field label="Person tag" hint="選「未安排」會清除實際職掌">{(p) => (
          <MultiSelect id={p.id} label="Person tag" noneLabel="未安排" options={tax.personTags.map((t) => ({ id: t.id, label: t.name }))} value={form.personTagIds} onChange={(v) => set({ personTagIds: v })} />
        )}</Field>
      </div>
      <div className="fb-row">
        <Field label="優先級">{(p) => (
          <select {...p} className="select" value={form.priority} onChange={(e) => set({ priority: e.target.value as FormState['priority'] })}>
            {(['P0', 'P1', 'P2', 'P3'] as const).map((k) => <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>)}
          </select>
        )}</Field>
        <Field label="版本" hint="與版本標籤是同一份資料">{(p) => (
          <select {...p} className="select" value={form.versionTagId ?? ''} onChange={(e) => set({ versionTagId: e.target.value || null })}>
            <option value="">未歸類</option>
            {vg.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}</Field>
        <Field label="＋標籤" hint="單選群組只能選一個">{(p) => (
          <MultiSelect id={p.id} label="標籤" placeholder="加入標籤" options={tagOptions(tax)} value={form.tagIds} onChange={(v) => set({ tagIds: v })} />
        )}</Field>
      </div>
      {personal && feedbackId ? <PersonalTagsRow feedbackId={feedbackId} /> : null}
    </div>
  );
}

/** Third row: the signed-in member's own private tags (auto-saved, never shared). */
function PersonalTagsRow({ feedbackId }: { feedbackId: string }) {
  const { product } = useProduct();
  const mine = useResource<{ id: string; name: string }[]>(`/products/${product.id}/personal/tags`);
  const current = useResource<{ revision: number; tags: { id: string }[] }>(`/products/${product.id}/personal/feedback/${feedbackId}/tags`);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [newName, setNewName] = useState('');
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
    <div className="fb-row fb-row-private" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
      <Field label={<span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><IconLock size={14} />個人 Tag（僅自己可見）</span>} hint={state === 'saving' ? '儲存中…' : state === 'saved' ? '已儲存' : state === 'error' ? '儲存失敗，已還原為最後確認的內容' : '自動儲存'}>{(p) => (
        mine.data && current.data ? (
          <MultiSelect id={p.id} label="個人 Tag" placeholder="未設定" options={mine.data.map((t) => ({ id: t.id, label: t.name }))} value={current.data.tags.map((t) => t.id)} onChange={save} />
        ) : <LoadingState />
      )}</Field>
      <form className="field" onSubmit={async (e) => {
        e.preventDefault();
        if (!newName.trim()) return;
        try {
          await api.post(`/products/${product.id}/personal/tags`, { body: { name: newName.trim() } });
          setNewName('');
          void mine.reload();
        } catch { setState('error'); }
      }}>
        <label className="field-label" htmlFor="new-personal-tag">新增個人 Tag</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input id="new-personal-tag" className="input" maxLength={50} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button type="submit" size="sm">新增</Button>
        </div>
      </form>
    </div>
  );
}

function ContentFields({ form, set, errors, autoFocus }: { form: FormState; set: (p: Partial<FormState>) => void; errors: Record<string, string>; autoFocus?: boolean }) {
  return (
    <>
      <Field label="標題" required error={errors.title}>{(p) => (
        <input {...p} className="input fb-title-input" maxLength={200} value={form.title} onChange={(e) => set({ title: e.target.value })} data-autofocus={autoFocus || undefined} placeholder="簡短描述需求" />
      )}</Field>
      <Field label="描述" hint="支援基本 Markdown：段落、清單、粗體與連結；不支援 HTML 與附件。" error={errors.description}>{(p) => (
        <textarea {...p} className="textarea" rows={5} maxLength={20000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
      )}</Field>
      <Field label="公開範圍" hint={form.visibility === 'public' ? '公開：前台可看到標題、描述、狀態與一般留言。' : '內部：只有團隊後台可見。'}>{(p) => (
        <select {...p} className="select" style={{ maxWidth: 220 }} value={form.visibility} onChange={(e) => set({ visibility: e.target.value as FormState['visibility'] })}>
          <option value="internal">內部</option>
          <option value="public">公開</option>
        </select>
      )}</Field>
    </>
  );
}

function CreateFeedback({ taxonomy, onClose, onChanged, personal }: Extract<Props, { mode: 'create' }>) {
  const { product } = useProduct();
  const { me } = useSite();
  const toast = useToast();
  const { announce, region } = useAnnouncer();
  const [form, setForm] = useState<FormState>(() => defaults(taxonomy));
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [multi, setMulti] = useState(false);
  const [tab, setTab] = useState('content');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const keyRef = useRef<string | null>(null);
  const [now] = useState(() => new Date().toISOString());
  const dirty = form.title.trim() !== '' || form.description.trim() !== '' || draft.actions.length > 0;
  useUnsaved('feedback-create', dirty);
  const set = (p: Partial<FormState>) => { keyRef.current = null; setForm((f) => ({ ...f, ...p })); };
  const setDraftState = (d: DraftState) => { keyRef.current = null; setDraft(d); };

  const submit = async () => {
    setErrors({});
    setTopError(null);
    if (!form.title.trim()) {
      setErrors({ title: '標題不可空白' });
      setTab('content');
      return;
    }
    // the same key is reused only when retrying an unchanged request
    keyRef.current ??= newKey();
    setPending(true);
    try {
      const r = await api.post<Feedback>(`/products/${product.id}/feedback`, {
        key: keyRef.current,
        body: { ...form, scheduleDraft: draft.actions.length ? { actions: draft.actions } : undefined },
      });
      keyRef.current = null;
      onChanged();
      if (multi) {
        // keep classification, clear text and the whole schedule draft
        setForm((f) => ({ ...f, title: '', description: '' }));
        setDraft(emptyDraft());
        setTab('content');
        announce(`已建立「${r.data.title}」，可繼續新增下一筆`);
        toast('success', `已建立「${r.data.title}」`);
      } else {
        toast('success', `已建立「${r.data.title}」`);
        onClose();
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setErrors(err?.body.fieldErrors ?? {});
      setTopError(errorMessage(e));
      if (err?.body.fieldErrors && Object.keys(err.body.fieldErrors).some((k) => k.startsWith('scheduleDraft'))) setTab('schedule');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal wide title="新增 Feedback" onClose={() => (dirty ? setConfirmClose(true) : onClose())} footer={<>
      <span className="spacer"><Switch checked={multi} onChange={setMulti} label="新增多筆" /></span>
      <Button onClick={() => (dirty ? setConfirmClose(true) : onClose())}>取消</Button>
      <Button variant="primary" pending={pending} onClick={submit}>建立</Button>
    </>}>
      {region}
      <div className="fb-author">
        <Avatar name={me?.displayName ?? ''} url={me?.avatarUrl} id={me?.id} size={28} />
        <span>{me?.displayName}</span><span className="small">· 建立時間由伺服器記錄（{formatDateTime(now)} 起）</span>
      </div>
      {topError ? <div className="banner banner-error" role="alert">{topError}（內容已保留）</div> : null}
      <Tabs label="Feedback 內容" value={tab} onChange={setTab} tabs={[{ id: 'content', label: '內容' }, { id: 'schedule', label: `Schedule${draft.actions.length ? `（草稿 ${draft.actions.length}）` : ''}` }]}>
        {tab === 'content' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ContentFields form={form} set={set} errors={errors} autoFocus />
            <ClassificationRows form={form} set={set} tax={taxonomy} personal={personal} />
          </div>
        ) : (
          <ScheduleDraftTab draft={draft} onChange={setDraftState} me={me} />
        )}
      </Tabs>
      {confirmClose ? (
        <ConfirmModal title="捨棄未建立的 Feedback？" confirmLabel="捨棄" danger onCancel={() => setConfirmClose(false)} onConfirm={onClose}>
          標題、描述與 Schedule 草稿都尚未送出，關閉後不會建立任何資料，也不會寄出通知。
        </ConfirmModal>
      ) : null}
    </Modal>
  );
}

function EditFeedback({ feedbackId, taxonomy, onClose, onChanged, personal }: Extract<Props, { mode: 'edit' }>) {
  const { product } = useProduct();
  const toast = useToast();
  const res = useResource<Feedback>(`/products/${product.id}/feedback/${feedbackId}`);
  const [form, setForm] = useState<FormState | null>(null);
  const [tab, setTab] = useState('content');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'error' | 'conflict' | 'saved'; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<'close' | 'delete' | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { if (res.data && !form) setForm(fromFeedback(res.data)); }, [res.data, form]);
  const base = useMemo(() => (res.data ? fromFeedback(res.data) : null), [res.data]);
  const dirty = Boolean(form && base && JSON.stringify(form) !== JSON.stringify(base));
  useUnsaved(`feedback-edit-${feedbackId}`, dirty);
  const set = (p: Partial<FormState>) => { setBanner(null); setForm((f) => (f ? { ...f, ...p } : f)); };

  if (res.loading) return <Modal wide title="Feedback" onClose={onClose}><LoadingState /></Modal>;
  if (res.error || !res.data) {
    return (
      <Modal wide title="Feedback" onClose={onClose}>
        <ErrorState title={res.error?.isNotFound ? '找不到此 Feedback' : '讀取失敗'} message={res.error?.isNotFound ? '它可能已被移除，或不屬於目前的產品。' : res.error?.message} onRetry={res.error?.isNotFound ? undefined : res.reload} />
      </Modal>
    );
  }
  const fb = res.data;
  const save = async () => {
    if (!form || !base) return;
    setErrors({});
    setBanner(null);
    const patch: Record<string, unknown> = {};
    (Object.keys(form) as (keyof FormState)[]).forEach((k) => {
      if (JSON.stringify(form[k]) !== JSON.stringify(base[k])) patch[k] = form[k];
    });
    if (patch.tagIds) patch.tagIds = [...(form.tagIds), ...(form.versionTagId ? [form.versionTagId] : [])];
    if (patch.tagIds && !('versionTagId' in patch)) patch.versionTagId = form.versionTagId;
    if (Object.keys(patch).length === 0) return;
    setPending(true);
    try {
      const r = await api.patch<Feedback>(`/products/${product.id}/feedback/${fb.id}`, { body: { ...patch, expectedRevision: fb.revision } });
      res.setData(r.data);
      setForm(fromFeedback(r.data));
      setBanner({ kind: 'saved', text: '已儲存' });
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setBanner({ kind: 'conflict', text: '內容已被其他人更新。你的修改仍保留在表單中，可載入最新內容後重新套用。' });
      else {
        setErrors(e instanceof ApiError ? e.body.fieldErrors : {});
        setBanner({ kind: 'error', text: errorMessage(e) });
      }
    } finally {
      setPending(false);
    }
  };
  const remove = async () => {
    setDeleting(true);
    try {
      await api.del(`/products/${product.id}/feedback/${fb.id}`, { ifMatch: fb.revision });
      toast('success', '已移除 Feedback');
      onChanged();
      onClose();
    } catch (e) {
      setBanner({ kind: e instanceof ApiError && e.status === 409 ? 'conflict' : 'error', text: errorMessage(e) });
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal wide title={fb.title} onClose={() => (dirty ? setConfirm('close') : onClose())} footer={tab === 'content' ? <>
      <span className="spacer"><Button variant="danger" size="sm" onClick={() => setConfirm('delete')}>移除</Button></span>
      {dirty ? <span className="small muted">有未儲存的修改</span> : null}
      <Button onClick={() => (dirty ? setConfirm('close') : onClose())}>關閉</Button>
      <Button variant="primary" pending={pending} disabled={!dirty} onClick={save}>儲存</Button>
    </> : undefined}>
      <div className="fb-author">
        <Avatar name={fb.author.displayName} url={fb.author.avatarUrl} id={fb.author.id} size={28} />
        <span>{fb.author.displayName}</span><span className="small">· {formatDateTime(fb.createdAt)}</span>
        <span className="chip">{fb.source === 'portal' ? '前台建立' : '後台建立'}</span>
      </div>
      {banner ? (
        <div className={`banner ${banner.kind === 'saved' ? 'banner-success' : banner.kind === 'error' ? 'banner-error' : ''}`} role={banner.kind === 'saved' ? 'status' : 'alert'}>
          {banner.kind === 'saved' ? <IconCheck /> : null}{banner.text}
          {banner.kind === 'conflict' ? <Button size="sm" onClick={async () => { await res.reload(); setForm(null); setBanner(null); }}>載入最新內容</Button> : null}
        </div>
      ) : null}
      <Tabs label="Feedback 內容" value={tab} onChange={setTab} tabs={[{ id: 'content', label: '內容' }, { id: 'schedule', label: 'Schedule' }]}>
        {tab === 'content' && form ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ContentFields form={form} set={set} errors={errors} />
            <ClassificationRows form={form} set={set} tax={taxonomy} personal={personal} feedbackId={fb.id} />
            <section aria-label="留言">
              <h3 style={{ marginBottom: 8 }}>留言</h3>
              <CommentThread productId={product.id} feedbackId={fb.id} isPublic={fb.visibility === 'public'} />
            </section>
          </div>
        ) : null}
        {tab === 'schedule' ? <ScheduleLiveTab productId={product.id} feedbackId={fb.id} /> : null}
      </Tabs>
      {confirm === 'close' ? (
        <ConfirmModal title="放棄未儲存的修改？" confirmLabel="放棄修改" danger onCancel={() => setConfirm(null)} onConfirm={onClose}>
          表單中的修改尚未儲存，關閉後會遺失。
        </ConfirmModal>
      ) : null}
      {confirm === 'delete' ? (
        <ConfirmModal title="移除這筆 Feedback？" confirmLabel="移除" danger pending={deleting} onCancel={() => setConfirm(null)} onConfirm={remove}>
          「{fb.title}」會從列表、看板、Personal 與前台消失（軟刪除，保留稽核紀錄）。留言與 Schedule 不會再顯示。
        </ConfirmModal>
      ) : null}
    </Modal>
  );
}
