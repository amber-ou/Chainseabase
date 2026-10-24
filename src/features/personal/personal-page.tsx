'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '@/client/api';
import { useResource } from '@/client/hooks';
import { useSite } from '@/client/site';
import { Avatar, Button, ErrorState, LoadingState, SaveStatus, useAnnouncer, type SaveState } from '@/components/ui';
import { ConfirmModal } from '@/components/modal';
import { ActionMenu } from '@/components/menu';
import { IconPlus } from '@/components/icons';
import { useProduct, useUnsaved } from '@/features/admin/shell';
import { FeedbackModal } from '@/features/feedback/feedback-modal';
import type { Feedback, Taxonomy } from '@/features/feedback/types';
import { Board, type BoardColumn } from '@/features/roadmap/board';

interface ViewData {
  view: { id: string; sortMode: 'create_time' | 'freedom'; revision: number } | null;
  subject: { id: string; displayName: string; avatarUrl: string | null; personTags: { id: string; name: string }[] };
  columns: { id: string; name: string; isDefault: boolean; cards: Feedback[] }[];
}
interface ProductUser { id: string; displayName: string; role: string; personTags: { id: string; name: string }[] }

export function PersonalPage() {
  const { product } = useProduct();
  const { me } = useSite();
  const users = useResource<ProductUser[]>(`/products/${product.id}/users`);
  const tax = useResource<Taxonomy>(`/products/${product.id}/taxonomy`);
  const [subjectId, setSubjectId] = useState<string>(me?.id ?? '');
  const [view, setView] = useState<ViewData | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | undefined>();
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [newCol, setNewCol] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string; count: number } | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const inflight = useRef(0);
  const { announce, region } = useAnnouncer();
  // a pending save or an unsaved column-name draft blocks silent product switches
  useUnsaved('personal', save === 'saving' || Boolean(renaming) || newCol.trim() !== '');

  const load = useCallback(async (subject: string) => {
    try {
      // owner is always the signed-in member; the server creates the view on first open
      const r = await api.post<ViewData>(`/products/${product.id}/personal/views`, { body: { subjectUserId: subject } });
      setView(r.data);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e : null);
    }
  }, [product.id]);
  useEffect(() => { if (subjectId) void load(subjectId); }, [subjectId, load]);
  useEffect(() => { if (!subjectId && me) setSubjectId(me.id); }, [me, subjectId]);

  const team = (users.data ?? []).filter((u) => u.role === 'team');

  /** Every private change saves immediately; failure restores the last confirmed state. */
  const mutate = async (label: string, fn: (rev: number) => Promise<unknown>, optimistic?: (v: ViewData) => ViewData) => {
    if (!view?.view) return;
    const confirmed = view;
    if (optimistic) setView(optimistic(view));
    setSave('saving');
    setSaveError(undefined);
    inflight.current++;
    try {
      await fn(view.view.revision);
      setSave('saved');
      announce(label);
      setRetry(null);
      await load(subjectId);
    } catch (e) {
      setView(confirmed);
      setSave('error');
      const conflict = e instanceof ApiError && e.status === 409;
      setSaveError(conflict ? '其他分頁已更新此檢視，已重新載入' : `儲存失敗：${errorMessage(e)}`);
      setRetry(() => () => void mutate(label, fn, optimistic));
      if (conflict) await load(subjectId);
    } finally {
      inflight.current--;
      setPendingId(null);
    }
  };

  const switchSubject = (id: string) => {
    if (save === 'saving') { announce('儲存中，請稍候再切換負責人'); return; }
    setView(null);
    setSubjectId(id);
  };

  if (users.loading || tax.loading) return <LoadingState />;
  if (users.error) return <ErrorState message={users.error.message} onRetry={users.reload} />;
  const v = view;
  const viewId = v?.view?.id;
  const columns: BoardColumn[] = (v?.columns ?? []).map((c) => ({
    id: c.id, title: c.name, count: c.cards.length, cards: c.cards, isDefault: c.isDefault,
    label: c.name,
    headerExtra: (
      <ActionMenu label={`欄位「${c.name}」選項`} items={[
        { label: '重新命名', onSelect: () => setRenaming({ id: c.id, name: c.name }) },
        { label: c.isDefault ? '預設欄不可刪除' : '刪除欄位', disabled: c.isDefault, danger: !c.isDefault, onSelect: () => setDeleting({ id: c.id, name: c.name, count: c.cards.length }) },
      ]} />
    ),
  }));

  return (
    <>
      {region}
      <div className="page-head">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="mark mark-personal" aria-hidden="true" />Personal</h1>
          <p className="sub">只屬於你的整理空間：私人欄位與排序，不會修改 Feedback 的狀態、類別或任何標籤。</p>
        </div>
        <SaveStatus state={save} errorText={saveError} onRetry={retry ?? undefined} />
      </div>
      <div className="toolbar">
        <label className="field-label" htmlFor="subject">負責人</label>
        <select id="subject" className="select" style={{ width: 220 }} value={subjectId} onChange={(e) => switchSubject(e.target.value)}>
          {team.map((u) => <option key={u.id} value={u.id}>{u.displayName}{u.id === me?.id ? '（我）' : ''}</option>)}
        </select>
        {v ? (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Avatar name={v.subject.displayName} url={v.subject.avatarUrl} id={v.subject.id} size={24} />
            {v.subject.personTags.length ? v.subject.personTags.map((t) => <span key={t.id} className="chip">{t.name}</span>) : <span className="chip chip-warning">未安排職掌</span>}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <label className="sr-only" htmlFor="p-sort">排序</label>
          <select id="p-sort" className="select" style={{ width: 160 }} value={v?.view?.sortMode ?? 'create_time'} disabled={!viewId}
            onChange={(e) => { const mode = e.target.value as 'create_time' | 'freedom'; void mutate(`已切換為${mode === 'freedom' ? '自由排序' : '建立時間排序'}`, (rev) => api.patch(`/products/${product.id}/personal/views/${viewId}`, { body: { sortMode: mode, expectedRevision: rev } })); }}>
            <option value="create_time">建立時間（新到舊）</option>
            <option value="freedom">自由排序</option>
          </select>
        </span>
      </div>
      {loadError ? <ErrorState message={loadError.message} onRetry={() => load(subjectId)} /> : !v ? <LoadingState /> : (
        <>
          {v.subject.personTags.length === 0 ? (
            <div className="banner banner-info" style={{ marginBottom: 12 }}>{v.subject.displayName} 目前沒有 Person tag，因此沒有負責的 Feedback。可在 User 或 Setting 指派職掌。</div>
          ) : null}
          <Board columns={columns} accent="personal" pendingId={pendingId} onOpen={setOpenCard}
            onMove={(cardId, targetColumnId, before, after) => {
              setPendingId(cardId);
              void mutate('已移動卡片', (rev) => api.post(`/products/${product.id}/personal/views/${viewId}/moves`, {
                body: { feedbackId: cardId, targetColumnId, beforeFeedbackId: before, afterFeedbackId: after, expectedRevision: rev },
              }), (cur) => {
                const card = cur.columns.flatMap((c) => c.cards).find((c) => c.id === cardId)!;
                const cols = cur.columns.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== cardId) }));
                const t = cols.find((c) => c.id === targetColumnId)!;
                const idx = before ? t.cards.findIndex((x) => x.id === before) : after ? t.cards.findIndex((x) => x.id === after) + 1 : 0;
                t.cards.splice(idx < 0 ? 0 : idx, 0, card);
                return { ...cur, columns: cols };
              });
            }} />
          <form className="toolbar" style={{ marginTop: 12 }} onSubmit={(e) => {
            e.preventDefault();
            const name = newCol.trim();
            if (!name || !viewId) return;
            void mutate(`已新增欄位「${name}」`, (rev) => api.post(`/products/${product.id}/personal/views/${viewId}/columns`, { body: { name, expectedRevision: rev } })).then(() => setNewCol(''));
          }}>
            <label className="sr-only" htmlFor="new-col">新欄位名稱</label>
            <input id="new-col" className="input" style={{ width: 220 }} maxLength={50} placeholder="新欄位名稱" value={newCol} onChange={(e) => setNewCol(e.target.value)} />
            <Button type="submit" disabled={!newCol.trim()}><IconPlus />新增欄位</Button>
            <span className="small muted">私人欄位只有名稱，沒有篩選條件；新指派的卡片會進入「負責的 Feedback」。</span>
          </form>
        </>
      )}
      {renaming && viewId ? (
        <ConfirmModal title="重新命名欄位" confirmLabel="儲存名稱" onCancel={() => setRenaming(null)} onConfirm={() => {
          const name = renaming.name.trim();
          if (!name) return;
          const id = renaming.id;
          void mutate('已更新欄位名稱', (rev) => api.patch(`/products/${product.id}/personal/views/${viewId}/columns/${id}`, { body: { name, expectedRevision: rev } })).then(() => setRenaming(null));
        }}>
          <label className="field-label" htmlFor="rename-col">欄位名稱</label>
          <input id="rename-col" className="input" maxLength={50} value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
        </ConfirmModal>
      ) : null}
      {deleting && viewId ? (
        <ConfirmModal title={`刪除欄位「${deleting.name}」？`} confirmLabel="刪除欄位" danger onCancel={() => setDeleting(null)} onConfirm={() => {
          const id = deleting.id;
          setDeleting(null);
          void mutate('已刪除欄位，卡片已移回預設欄', (rev) => api.del(`/products/${product.id}/personal/views/${viewId}/columns/${id}`, { ifMatch: rev }));
        }}>
          欄位中的 {deleting.count} 張卡片會移回「負責的 Feedback」，不會刪除任何 Feedback。
        </ConfirmModal>
      ) : null}
      {openCard && tax.data ? <FeedbackModal mode="edit" personal feedbackId={openCard} taxonomy={tax.data} onClose={() => setOpenCard(null)} onChanged={() => void load(subjectId)} /> : null}
    </>
  );
}
