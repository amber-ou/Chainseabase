'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Settings2Icon } from 'lucide-react';
import { api, ApiError, errorMessage, newKey } from '@/client/api';
import { useDebounced, useResource } from '@/client/hooks';
import { Button, ErrorState, Field, LoadingState, Spinner, useAnnouncer } from '@/components/ui';
import { Button as UiButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch as UiSwitch } from '@/components/ui/switch';
import { CheckChoices, FilterPopover, IconTip, FilterSection, QuietEmpty, RadioChoices, SearchBox } from '@/components/list-controls';
import { SortableList } from '@/components/sortable-list';
import { ConfirmModal, Modal } from '@/components/modal';
import { IconPlus } from '@/components/icons';
import { useToast } from '@/components/toast';
import { useProduct } from '@/features/admin/shell';
import { FeedbackModal } from '@/features/feedback/feedback-modal';
import { tagOptions, type Feedback, type Taxonomy } from '@/features/feedback/types';
import { Board, type BoardColumn } from './board';

interface Roadmap { id: string; name: string; description: string; dimension: 'status' | 'category' | 'tag_group'; tagGroupId: string | null; tagGroupName: string | null; sortMode: 'create_time' | 'freedom'; isDefault: boolean; portalPublished: boolean; revision: number }
type BoardCard = Feedback & { placementRevision: number };
interface BoardData { roadmap: Roadmap; columns: { id: string; label: string; count: number; isUnclassified: boolean; cards: BoardCard[] }[] }

const DIMENSION_LABEL: Record<string, string> = { status: '狀態', category: '類別', tag_group: 'Tag 群組' };

export function RoadmapPage() {
  const { product } = useProduct();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const roadmaps = useResource<Roadmap[]>(`/products/${product.id}/roadmaps`);
  const tax = useResource<Taxonomy>(`/products/${product.id}/taxonomy`);
  const selectedId = params.get('board') ?? roadmaps.data?.[0]?.id ?? null;
  const [creating, setCreating] = useState(false);
  const [creatingFeedback, setCreatingFeedback] = useState(false);
  const [settings, setSettings] = useState(false);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const select = (id: string) => router.replace(`${pathname}?board=${id}`, { scroll: false });

  // R03/R05: keep the selected tab in view inside the scrolling tab row
  const tabRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // scrollLeft, not scrollIntoView: that would also move the browser's Tab starting point to the tab
    const row = tabRowRef.current;
    const tab = row?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!row || !tab) return;
    const left = tab.offsetLeft - row.offsetLeft, right = left + tab.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
  }, [selectedId, roadmaps.data]);
  const list = roadmaps.data ?? [];
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const j = e.key === 'ArrowRight' ? (i + 1) % list.length : e.key === 'ArrowLeft' ? (i - 1 + list.length) % list.length : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
    if (j === null) return;
    e.preventDefault();
    select(list[j].id);
    tabRowRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[j]?.focus();
  };

  return (
    <>
      {/* R01: the title has no icon; the status columns keep their colour marks */}
      <div className="page-head">
        <div>
          <h1>Roadmap</h1>
          <p className="sub">每張看板只依一個維度分欄；拖曳只修改該維度，每筆 Feedback 恰好出現在一欄。</p>
        </div>
      </div>
      {/* R02: the existing create-Feedback flow, below the description and above the tabs */}
      <div className="roadmap-create">
        <Button variant="primary" onClick={() => setCreatingFeedback(true)} disabled={!tax.data}><IconPlus />新增 Feedback</Button>
      </div>
      {roadmaps.loading ? <LoadingState /> : roadmaps.error ? <ErrorState message={roadmaps.error.message} onRetry={roadmaps.reload} /> : (
        <>
          {/* R03-R05: the tabs and, right after the last one, 新增 Roadmap; the row scrolls sideways on its own */}
          <div ref={tabRowRef} className="board-tabs">
            <div className="tabs" role="tablist" aria-label="看板">
              {list.map((r, i) => (
                <button key={r.id} type="button" role="tab" className="tab" aria-selected={r.id === selectedId} tabIndex={r.id === selectedId ? 0 : -1}
                  onClick={() => select(r.id)} onKeyDown={(e) => onTabKey(e, i)}>
                  {r.name}<span className="small muted">（{r.dimension === 'tag_group' ? r.tagGroupName : DIMENSION_LABEL[r.dimension]}）</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="board-tabs-add" onClick={() => setCreating(true)}><IconPlus />新增 Roadmap</Button>
          </div>
          {selectedId ? (
            <RoadmapBoard key={selectedId} roadmapId={selectedId} taxonomy={tax.data ?? null} onOpen={setOpenCard} onSettings={() => setSettings(true)} onRoadmapsChanged={() => void roadmaps.reload()} />
          ) : <QuietEmpty>尚無看板，可從「新增 Roadmap」建立。</QuietEmpty>}
        </>
      )}
      {creating && tax.data ? (
        <CreateRoadmapModal taxonomy={tax.data} onClose={() => setCreating(false)} onCreated={async (id) => { setCreating(false); await roadmaps.reload(); select(id); }} />
      ) : null}
      {settings && selectedId ? (
        <RoadmapSettings roadmapId={selectedId} onClose={() => setSettings(false)} onChanged={() => void roadmaps.reload()} onDeleted={async () => { setSettings(false); await roadmaps.reload(); router.replace(pathname); }} />
      ) : null}
      {creatingFeedback && tax.data ? (
        <FeedbackModal mode="create" taxonomy={tax.data} onClose={() => setCreatingFeedback(false)} onChanged={() => window.dispatchEvent(new Event('csb:board-refresh'))} />
      ) : null}
      {openCard && tax.data ? <FeedbackModal mode="edit" feedbackId={openCard} taxonomy={tax.data} onClose={() => setOpenCard(null)} onChanged={() => window.dispatchEvent(new Event('csb:board-refresh'))} /> : null}
    </>
  );
}

function RoadmapBoard({ roadmapId, taxonomy, onOpen, onSettings, onRoadmapsChanged }: { roadmapId: string; taxonomy: Taxonomy | null; onOpen: (id: string) => void; onSettings: () => void; onRoadmapsChanged: () => void }) {
  const { product } = useProduct();
  const board = useResource<BoardData>(`/products/${product.id}/roadmaps/${roadmapId}/board?limit=50`);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { announce, region } = useAnnouncer();
  const toast = useToast();
  // R10/R11: search and filters only change what this board shows (the loaded cards); nothing is saved
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const debouncedQ = useDebounced(q, 200);
  // R07/R08: the publish switch saves at once; while saving it shows the requested state and cannot be
  // toggled again; on failure it returns to the saved state and the reason is shown
  const [publishing, setPublishing] = useState<boolean | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  useEffect(() => {
    const h = () => void board.reload();
    window.addEventListener('csb:board-refresh', h);
    return () => window.removeEventListener('csb:board-refresh', h);
  }, [board]);

  if (board.loading) return <LoadingState />;
  if (board.error) {
    return board.error.code === 'DATA_INCONSISTENCY'
      ? <ErrorState title="資料一致性錯誤" message={`${board.error.message} 請在 Feedback 中修正該筆的單選標籤。`} onRetry={board.reload} />
      : <ErrorState message={board.error.message} onRetry={board.reload} />;
  }
  const data = board.data!;
  const rm = data.roadmap;

  const move = async (cardId: string, targetColumnId: string, beforeId: string | null, afterId: string | null) => {
    const card = data.columns.flatMap((c) => c.cards).find((c) => c.id === cardId);
    if (!card) return;
    const prev = data;
    const target = data.columns.find((c) => c.id === targetColumnId)!;
    // optimistic placement with pending marker; reverted on failure
    board.setData((d) => {
      if (!d) return d!;
      const cols = d.columns.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== cardId), count: c.cards.some((x) => x.id === cardId) && c.id !== targetColumnId ? c.count - 1 : c.count }));
      const t = cols.find((c) => c.id === targetColumnId)!;
      const idx = beforeId ? t.cards.findIndex((x) => x.id === beforeId) : afterId ? t.cards.findIndex((x) => x.id === afterId) + 1 : 0;
      t.cards.splice(idx < 0 ? 0 : idx, 0, card);
      if (!prev.columns.find((c) => c.id === targetColumnId)!.cards.some((x) => x.id === cardId)) t.count += 1;
      return { ...d, columns: cols };
    });
    setPendingId(cardId);
    setError(null);
    try {
      await api.post(`/products/${product.id}/roadmaps/${rm.id}/moves`, {
        key: newKey(),
        body: { feedbackId: cardId, targetColumnId, beforeFeedbackId: beforeId, afterFeedbackId: afterId, expectedFeedbackRevision: card.revision, expectedPlacementRevision: card.placementRevision },
      });
      announce(`已將「${card.title}」移到「${target.label}」`);
      if (rm.sortMode === 'create_time') toast('info', '已切換為自由排序');
      await board.reload();
      onRoadmapsChanged();
    } catch (e) {
      board.setData(prev);
      // conflicts are shown, never retried automatically: the user decides the new drop position
      const msg = e instanceof ApiError && e.status === 409
        ? (e.body.details?.reason === 'order_changed' ? '欄位順序剛被其他人調整，已重新載入，請再放置一次。' : e.body.details?.reason === 'card_changed' ? '這張卡片剛被其他人移動或修改，已重新載入。' : `${e.message} 已重新載入。`)
        : errorMessage(e);
      setError(msg);
      announce(`移動失敗：${msg}`);
      void board.reload();
    } finally {
      setPendingId(null);
    }
  };
  const setSort = async (mode: 'create_time' | 'freedom') => {
    try {
      await api.patch(`/products/${product.id}/roadmaps/${rm.id}`, { body: { sortMode: mode, expectedRevision: rm.revision } });
      await board.reload();
      onRoadmapsChanged();
    } catch (e) { setError(errorMessage(e)); void board.reload(); }
  };
  const publish = async (v: boolean) => {
    if (publishing !== null) return;
    setPublishing(v);
    setPublishError(null);
    try {
      await api.patch(`/products/${product.id}/roadmaps/${rm.id}`, { body: { portalPublished: v, expectedRevision: rm.revision } });
      await board.reload();
      onRoadmapsChanged();
      announce(v ? '已發佈到前台' : '已停止發佈到前台');
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 409 ? '看板剛被其他人修改，已重新載入，請再切換一次。' : errorMessage(e);
      setPublishError(`發佈狀態未變更：${msg}`);
      void board.reload();
    } finally { setPublishing(null); }
  };

  const needle = debouncedQ.trim().toLowerCase();
  const filtering = Boolean(needle || categoryId || tagIds.length);
  const matches = (card: BoardCard) => (!needle || card.title.toLowerCase().includes(needle) || (card.description ?? '').toLowerCase().includes(needle))
    && (!categoryId || card.category?.id === categoryId)
    && tagIds.every((t) => card.tags?.some((x) => x.id === t));
  const columns: BoardColumn[] = data.columns.map((c) => {
    const cards = filtering ? c.cards.filter(matches) : c.cards;
    // while filtering, a column counts what it shows (the loaded cards that match)
    return { id: c.id, label: c.label, title: c.label, count: filtering ? cards.length : c.count, cards };
  });
  const partlyLoaded = data.columns.some((c) => c.count > c.cards.length);
  const canPublish = rm.dimension === 'status';
  const published = publishing ?? rm.portalPublished;

  return (
    <div>
      {region}
      {/* R06: publish switch, its text and the settings icon on the left; Filter and search on the right */}
      <div className="list-toolbar">
        <div className="list-toolbar-start">
          <span className="publish-toggle">
            <UiSwitch id="rm-publish" checked={published} disabled={!canPublish || publishing !== null} aria-busy={publishing !== null || undefined}
              aria-describedby={canPublish ? undefined : 'rm-publish-note'} onCheckedChange={publish} />
            <label htmlFor="rm-publish" className={canPublish ? '' : 'muted'}>發佈到前台</label>
            {canPublish ? null : <span id="rm-publish-note" className="small muted">（僅狀態看板）</span>}
            {publishing !== null ? <Spinner label="儲存中" /> : null}
          </span>
          <IconTip label="看板設定">
            <UiButton variant="ghost" size="icon" aria-label="看板設定" onClick={onSettings}><Settings2Icon aria-hidden="true" /></UiButton>
          </IconTip>
        </div>
        <div className="list-toolbar-end" role="search" aria-label="搜尋與篩選看板 Feedback">
          {board.refreshing ? <Spinner label="更新中" /> : null}
          <FilterPopover active={Boolean(categoryId || tagIds.length)} onClear={() => { setCategoryId(''); setTagIds([]); }}>
            <FilterSection title="類別">
              <RadioChoices name={`rm-category-${rm.id}`} allLabel="全部類別" value={categoryId} onChange={setCategoryId}
                options={taxonomy?.categories.map((c) => ({ id: c.id, label: c.name })) ?? []} />
            </FilterSection>
            <FilterSection title="標籤">
              <CheckChoices value={tagIds} onChange={setTagIds} options={taxonomy ? tagOptions(taxonomy).map((o) => ({ id: o.id, label: o.label, group: o.group })) : []} emptyLabel="這個產品尚無標籤" />
            </FilterSection>
            {/* the board's existing sort setting (saved on the board, as before) */}
            <FilterSection title="排序">
              <RadioChoices name={`rm-sort-${rm.id}`} value={rm.sortMode} onChange={(v) => void setSort(v as Roadmap['sortMode'])}
                options={[{ id: 'freedom', label: '自由排序' }, { id: 'create_time', label: '建立時間（新到舊）' }]} />
            </FilterSection>
          </FilterPopover>
          <SearchBox id={`rm-search-${rm.id}`} label="搜尋看板 Feedback" value={q} onChange={setQ} className="list-toolbar-search" />
        </div>
      </div>
      {publishError ? <div className="banner banner-error" role="alert" style={{ marginBottom: 12 }}>{publishError}</div> : null}
      {error ? <div className="banner banner-error" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
      {filtering && partlyLoaded ? <p className="small muted" style={{ margin: '0 0 8px' }}>搜尋與篩選只套用於目前已載入的卡片。</p> : null}
      {filtering && columns.every((c) => c.cards.length === 0) ? (
        <QuietEmpty>沒有符合目前搜尋或篩選條件的 Feedback，可調整關鍵字或清除篩選。</QuietEmpty>
      ) : (
        <Board columns={columns} accent="roadmap" plain onMove={move} pendingId={pendingId} onOpen={onOpen} hideUnloaded={filtering}
          cardExtra={(card) => {
            const f = card as unknown as Feedback;
            const tags = [f.category?.name, f.version ? `版本 ${f.version.name}` : null].filter(Boolean);
            return tags.length ? <div className="chips">{tags.slice(0, 2).map((t) => <span key={t} className="chip">{t}</span>)}</div> : null;
          }} />
      )}
    </div>
  );
}

function CreateRoadmapModal({ taxonomy, onClose, onCreated }: { taxonomy: Taxonomy; onClose: () => void; onCreated: (id: string) => void }) {
  const { product } = useProduct();
  const singleGroups = taxonomy.tagGroups.filter((g) => g.selectionMode === 'single');
  const multiGroups = taxonomy.tagGroups.filter((g) => g.selectionMode === 'multiple');
  const [name, setName] = useState('');
  const [dimension, setDimension] = useState<'status' | 'category' | 'tag_group'>('status');
  const [groupId, setGroupId] = useState(singleGroups[0]?.id ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const submit = async () => {
    setPending(true);
    setErrors({});
    try {
      const r = await api.post(`/products/${product.id}/roadmaps`, { body: { name, dimension, tagGroupId: dimension === 'tag_group' ? groupId : null } });
      onCreated(r.data.id);
    } catch (e) {
      setErrors(e instanceof ApiError ? { ...e.body.fieldErrors, _: e.message } : { _: errorMessage(e) });
    } finally { setPending(false); }
  };
  return (
    <Modal title="新增看板" onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" pending={pending} onClick={submit}>建立看板</Button></>}>
      {errors._ ? <div className="banner banner-error" role="alert">{errors._}</div> : null}
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend className="field-label" style={{ marginBottom: 6 }}>分欄維度（建立後不可修改）</legend>
        {(['status', 'category', 'tag_group'] as const).map((d) => (
          <label key={d} className="ms-option"><input type="radio" name="dimension" checked={dimension === d} onChange={() => setDimension(d)} />{d === 'tag_group' ? '單選 Tag 群組' : DIMENSION_LABEL[d]}</label>
        ))}
      </fieldset>
      {dimension === 'tag_group' ? (
        <Field label="Tag 群組" hint={multiGroups.length ? `複選群組不適用：${multiGroups.map((g) => g.name).join('、')}` : '只列出單選群組'} error={errors.tagGroupId}>{(p) => (
          <select {...p} className="select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {singleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}</Field>
      ) : null}
      <Field label="看板名稱" required error={errors.name}>{(p) => <Input {...p} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} data-autofocus />}</Field>
      <p className="small muted">每個選項自動成為一欄{dimension === 'tag_group' ? '，另有固定的「未歸類」欄' : ''}；不提供 AND／OR 或自訂條件。</p>
    </Modal>
  );
}

function RoadmapSettings({ roadmapId, onClose, onChanged, onDeleted }: { roadmapId: string; onClose: () => void; onChanged: () => void; onDeleted: () => void }) {
  const { product } = useProduct();
  const board = useResource<BoardData>(`/products/${product.id}/roadmaps/${roadmapId}/board?limit=1`);
  const [name, setName] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  // R15: the column order is changed here and saved with 儲存, like the names (取消 discards it)
  const [order, setOrder] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!board.data) return <Modal title="看板設定" onClose={onClose}>{board.error ? <ErrorState message={board.error.message} onRetry={board.reload} /> : <LoadingState />}</Modal>;
  const rm = board.data.roadmap;
  const savedOrder = board.data.columns.map((c) => c.id);
  const currentOrder = order ?? savedOrder;
  const nameValue = name ?? rm.name;
  const nameError = name !== null && !name.trim() ? '請輸入看板名稱' : null;
  const save = async () => {
    if (nameError) return;
    setPending(true);
    setError(null);
    try {
      let rev = rm.revision;
      if (nameValue !== rm.name) {
        rev = (await api.patch(`/products/${product.id}/roadmaps/${rm.id}`, { body: { name: nameValue, expectedRevision: rev } })).data.revision;
      }
      for (const [colId, label] of Object.entries(labels)) {
        const col = board.data!.columns.find((c) => c.id === colId)!;
        if (label.trim() && label !== col.label) rev = (await api.patch(`/products/${product.id}/roadmaps/${rm.id}/columns/${colId}`, { body: { label, expectedRevision: rev } })).data.roadmapRevision;
      }
      if (currentOrder.join() !== savedOrder.join()) {
        await api.put(`/products/${product.id}/roadmaps/${rm.id}/columns/order`, { body: { columnIds: currentOrder, expectedRevision: rev } });
      }
      onChanged();
      window.dispatchEvent(new Event('csb:board-refresh'));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? '看板剛被其他人修改，已重新載入；請確認後再儲存。' : errorMessage(e));
      setOrder(null);
      void board.reload();
    } finally { setPending(false); }
  };
  return (
    <Modal title="看板設定" onClose={onClose} footer={<>
      {!rm.isDefault ? <span className="spacer"><Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>刪除看板</Button></span> : <span className="spacer small muted">預設看板不可刪除</span>}
      <Button onClick={onClose}>取消</Button><Button variant="primary" pending={pending} disabled={Boolean(nameError)} onClick={save}>儲存</Button>
    </>}>
      {error ? <div className="banner banner-error" role="alert">{error}</div> : null}
      {/* R12-R14: name and column names only, in shadcn Input; the description, the dimension note, tab order and the Setting note are gone */}
      <Field label="名稱" required error={nameError}>{(p) => <Input {...p} maxLength={60} value={nameValue} onChange={(e) => setName(e.target.value)} />}</Field>
      <div>
        <div className="field-label" id="rm-columns-label" style={{ marginBottom: 6 }}>欄位顯示名稱與順序</div>
        <SortableList label="欄位顯示名稱與順序" order={currentOrder} onChange={setOrder}
          items={board.data.columns.map((c) => ({
            id: c.id, name: labels[c.id] ?? c.label,
            content: (
              <>
                <Input id={`col-${c.id}`} aria-label={`「${c.label}」欄位名稱`} maxLength={50} className="min-w-0 flex-1" value={labels[c.id] ?? c.label}
                  onChange={(e) => setLabels((l) => ({ ...l, [c.id]: e.target.value }))} />
                {c.isUnclassified ? <span className="chip">未歸類</span> : null}
              </>
            ),
          }))} />
      </div>
      {confirmDelete ? (
        <ConfirmModal title={`刪除看板「${rm.name}」？`} confirmLabel="刪除看板" danger onCancel={() => setConfirmDelete(false)} onConfirm={async () => {
          try { await api.del(`/products/${product.id}/roadmaps/${rm.id}`, { ifMatch: rm.revision }); onDeleted(); } catch (e) { setError(errorMessage(e)); setConfirmDelete(false); }
        }}>只刪除看板與它的排序，Feedback 及其分類完全保留。</ConfirmModal>
      ) : null}
    </Modal>
  );
}
