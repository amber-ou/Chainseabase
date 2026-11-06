'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '@/client/api';
import { useResource } from '@/client/hooks';
import { useSite } from '@/client/site';
import { Avatar, ErrorState, LoadingState, SaveStatus, useAnnouncer, type SaveState } from '@/components/ui';
import { ConfirmModal } from '@/components/modal';
import { ActionMenu } from '@/components/menu';
import { ArrowUpDownIcon, PlusIcon } from 'lucide-react';
import { Button as UiButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconTip } from '@/components/list-controls';
import { useProduct, useUnsaved } from '@/features/admin/shell';
import { FeedbackModal } from '@/features/feedback/feedback-modal';
import type { Feedback, Taxonomy } from '@/features/feedback/types';
import { Board, type BoardColumn } from '@/features/roadmap/board';

interface ViewData {
  view: { id: string; sortMode: 'create_time' | 'freedom'; revision: number } | null;
  subject: { id: string; displayName: string; avatarUrl: string | null; personTags: { id: string; name: string }[] };
  columns: { id: string; name: string; isDefault: boolean; cards: Feedback[] }[];
}
interface ProductUser { id: string; displayName: string; role: string; avatarUrl: string | null; personTags: { id: string; name: string }[] }

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
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string; count: number } | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const inflight = useRef(0);
  const { announce, region } = useAnnouncer();
  // a pending save or an unsaved column-name draft blocks silent product switches
  useUnsaved('personal', save === 'saving' || Boolean(renaming) || (adding && newCol.trim() !== ''));

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
  /** Resolves true when saved: callers clear their input or close their dialog only then. */
  const mutate = async (label: string, fn: (rev: number) => Promise<unknown>, optimistic?: (v: ViewData) => ViewData): Promise<boolean> => {
    if (!view?.view) return false;
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
      return true;
    } catch (e) {
      setView(confirmed);
      setSave('error');
      const conflict = e instanceof ApiError && e.status === 409;
      setSaveError(conflict ? '其他分頁已更新此檢視，已重新載入' : `儲存失敗：${errorMessage(e)}`);
      setRetry(() => () => void mutate(label, fn, optimistic));
      if (conflict) await load(subjectId);
      return false;
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
        // a fresh dialog starts without an earlier save's error
        { label: '重新命名', onSelect: () => { if (save === 'error') setSave('idle'); setRenaming({ id: c.id, name: c.name }); } },
        { label: c.isDefault ? '預設欄不可刪除' : '刪除欄位', disabled: c.isDefault, danger: !c.isDefault, onSelect: () => setDeleting({ id: c.id, name: c.name, count: c.cards.length }) },
      ]} />
    ),
  }));

  return (
    <>
      {region}
      {/* PE01/PE02: the title only (no icon, no explanatory text); the rules themselves are unchanged */}
      <div className="page-head">
        <div><h1>Personal</h1></div>
        <SaveStatus state={save} errorText={saveError} onRetry={retry ?? undefined} />
      </div>
      {/* PE04: 負責人 and its Select on the left; the sort icon and 新增欄位 on the right */}
      <div className="list-toolbar">
        <div className="list-toolbar-start personal-subject">
          <label className="field-label" id="subject-label" htmlFor="subject">負責人</label>
          {/* PE03: avatar, name (「我」 for yourself) and Person tags inside the trigger and in every option */}
          <Select value={subjectId} onValueChange={switchSubject}>
            <SelectTrigger id="subject" aria-labelledby="subject-label subject" className="personal-subject-trigger h-auto min-h-9 w-auto min-w-0 max-w-full bg-background py-1.5">
              <SelectValue placeholder="選擇負責人" />
            </SelectTrigger>
            <SelectContent position="popper" align="start" className="max-w-[min(28rem,calc(100vw-2rem))]">
              {team.map((u) => (
                <SelectItem key={u.id} value={u.id} className="py-2">
                  <span className="personal-person">
                    <Avatar name={u.displayName} url={u.avatarUrl} id={u.id} size={22} />
                    <span className="personal-person-name">{u.displayName}{u.id === me?.id ? '（我）' : ''}</span>
                    <span className="personal-person-tags">
                      {u.personTags.length ? u.personTags.map((t) => <span key={t.id} className="chip">{t.name}</span>) : <span className="chip chip-warning">未安排職掌</span>}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="list-toolbar-end">
          <DropdownMenu>
            <IconTip label="排序">
              <DropdownMenuTrigger asChild>
                <UiButton variant="outline" size="icon" className="bg-background" aria-label="排序" disabled={!viewId}><ArrowUpDownIcon aria-hidden="true" /></UiButton>
              </DropdownMenuTrigger>
            </IconTip>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuLabel>排序</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={v?.view?.sortMode ?? 'create_time'}
                onValueChange={(value) => { const mode = value as 'create_time' | 'freedom'; void mutate(`已切換為${mode === 'freedom' ? '自由排序' : '建立時間排序'}`, (rev) => api.patch(`/products/${product.id}/personal/views/${viewId}`, { body: { sortMode: mode, expectedRevision: rev } })); }}>
                <DropdownMenuRadioItem value="create_time">建立時間（新到舊）</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="freedom">自由排序</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* PE05: the name is asked in a dialog; nothing stays open under the board */}
          <Dialog open={adding} onOpenChange={(o) => { if (save === 'saving' && !o) return; setAdding(o); if (!o) { setNewCol(''); setAddError(null); } }}>
            <DialogTrigger asChild>
              <UiButton variant="outline" className="bg-background" disabled={!viewId}><PlusIcon aria-hidden="true" />新增欄位</UiButton>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <form className="contents" onSubmit={async (e) => {
                e.preventDefault();
                const name = newCol.trim();
                if (!name || !viewId || save === 'saving') return;
                setAddError(null);
                // the name stays when the add fails, so it can be sent again
                const ok = await mutate(`已新增欄位「${name}」`, (rev) => api.post(`/products/${product.id}/personal/views/${viewId}/columns`, { body: { name, expectedRevision: rev } }));
                if (ok) { setAdding(false); setNewCol(''); } else setAddError('新增失敗，名稱仍保留，可修改後再試。');
              }}>
                <DialogHeader>
                  <DialogTitle>新增欄位</DialogTitle>
                  <DialogDescription>私人欄位只有你看得到。</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1.5">
                  <label className="field-label" htmlFor="new-col">欄位名稱</label>
                  <Input id="new-col" maxLength={50} value={newCol} autoFocus aria-invalid={addError ? true : undefined} aria-describedby={addError ? 'new-col-error' : undefined}
                    onChange={(e) => { setNewCol(e.target.value); setAddError(null); }} />
                  {addError || (save === 'error' && saveError) ? <span id="new-col-error" className="field-error" role="alert">{saveError ?? addError}</span> : null}
                </div>
                <DialogFooter>
                  <UiButton type="button" variant="cancel" disabled={save === 'saving'} onClick={() => { setAdding(false); setNewCol(''); setAddError(null); }}>取消</UiButton>
                  <UiButton type="submit" disabled={!newCol.trim()} aria-busy={save === 'saving' || undefined}>{save === 'saving' ? '新增中…' : '新增'}</UiButton>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
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
        </>
      )}
      {renaming && viewId ? (
        // the result shows inside the dialog: one save at a time, and a failure is visible where the name is
        <ConfirmModal title="重新命名欄位" confirmLabel="儲存名稱" pending={save === 'saving'} error={save === 'error' ? saveError ?? '儲存失敗' : null} onCancel={() => setRenaming(null)} onConfirm={() => {
          const name = renaming.name.trim();
          if (!name) return;
          const id = renaming.id;
          // a failed rename keeps the dialog and the typed name open (the save status says why)
          void mutate('已更新欄位名稱', (rev) => api.patch(`/products/${product.id}/personal/views/${viewId}/columns/${id}`, { body: { name, expectedRevision: rev } })).then((ok) => { if (ok) setRenaming(null); });
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
