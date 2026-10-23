'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError, errorMessage, newKey } from '@/client/api';
import { useResource } from '@/client/hooks';
import { Button, EmptyState, ErrorState, Field, LoadingState, Spinner, Switch, useAnnouncer } from '@/components/ui';
import { ConfirmModal, Modal } from '@/components/modal';
import { IconPlus, IconSettings } from '@/components/icons';
import { useToast } from '@/components/toast';
import { useProduct } from '@/features/admin/shell';
import { FeedbackModal } from '@/features/feedback/feedback-modal';
import type { Feedback, Taxonomy } from '@/features/feedback/types';
import { Board, type BoardColumn } from './board';

interface Roadmap { id: string; name: string; description: string; dimension: 'status' | 'category' | 'tag_group'; tagGroupId: string | null; tagGroupName: string | null; sortMode: 'create_time' | 'freedom'; isDefault: boolean; portalPublished: boolean; revision: number }
interface BoardData { roadmap: Roadmap; columns: { id: string; label: string; count: number; isUnclassified: boolean; cards: Feedback[] }[] }

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
  const [settings, setSettings] = useState(false);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const select = (id: string) => router.replace(`${pathname}?board=${id}`, { scroll: false });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="mark mark-roadmap" aria-hidden="true" />Roadmap</h1>
          <p className="sub">每張看板只依一個維度分欄；拖曳只修改該維度，每筆 Feedback 恰好出現在一欄。</p>
        </div>
      </div>
      {roadmaps.loading ? <LoadingState /> : roadmaps.error ? <ErrorState message={roadmaps.error.message} onRetry={roadmaps.reload} /> : (
        <>
          <div className="board-tabs">
            <div className="tabs" role="tablist" aria-label="看板">
              {(roadmaps.data ?? []).map((r) => (
                <button key={r.id} type="button" role="tab" className="tab" aria-selected={r.id === selectedId} onClick={() => select(r.id)}>
                  {r.name}<span className="small muted">（{r.dimension === 'tag_group' ? r.tagGroupName : DIMENSION_LABEL[r.dimension]}）</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" icon aria-label="新增看板" onClick={() => setCreating(true)}><IconPlus /></Button>
          </div>
          {selectedId ? (
            <RoadmapBoard key={selectedId} roadmapId={selectedId} onOpen={setOpenCard} onSettings={() => setSettings(true)} onRoadmapsChanged={() => void roadmaps.reload()} />
          ) : <EmptyState title="沒有看板" action={<Button onClick={() => setCreating(true)}>新增看板</Button>} />}
        </>
      )}
      {creating && tax.data ? (
        <CreateRoadmapModal taxonomy={tax.data} onClose={() => setCreating(false)} onCreated={async (id) => { setCreating(false); await roadmaps.reload(); select(id); }} />
      ) : null}
      {settings && selectedId ? (
        <RoadmapSettings roadmapId={selectedId} onClose={() => setSettings(false)} onChanged={() => void roadmaps.reload()} onDeleted={async () => { setSettings(false); await roadmaps.reload(); router.replace(pathname); }}
          onMoveTab={async (dir) => {
            const ids = (roadmaps.data ?? []).map((r) => r.id);
            const i = ids.indexOf(selectedId);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= ids.length) return;
            [ids[i], ids[j]] = [ids[j], ids[i]];
            await api.put(`/products/${product.id}/roadmaps/order`, { body: { roadmapIds: ids, expectedRevision: roadmaps.meta.productRevision } });
            await roadmaps.reload();
          }} />
      ) : null}
      {openCard && tax.data ? <FeedbackModal mode="edit" feedbackId={openCard} taxonomy={tax.data} onClose={() => setOpenCard(null)} onChanged={() => window.dispatchEvent(new Event('csb:board-refresh'))} /> : null}
    </>
  );
}

function RoadmapBoard({ roadmapId, onOpen, onSettings, onRoadmapsChanged }: { roadmapId: string; onOpen: (id: string) => void; onSettings: () => void; onRoadmapsChanged: () => void }) {
  const { product } = useProduct();
  const board = useResource<BoardData>(`/products/${product.id}/roadmaps/${roadmapId}/board?limit=50`);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { announce, region } = useAnnouncer();
  const toast = useToast();
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
        body: { feedbackId: cardId, targetColumnId, beforeFeedbackId: beforeId, afterFeedbackId: afterId, expectedFeedbackRevision: card.revision, expectedRoadmapRevision: rm.revision },
      });
      announce(`已將「${card.title}」移到「${target.label}」`);
      if (rm.sortMode === 'create_time') toast('info', '已切換為自由排序');
      await board.reload();
      onRoadmapsChanged();
    } catch (e) {
      board.setData(prev);
      const msg = e instanceof ApiError && e.status === 409 ? '看板或卡片已被其他人更新，已重新載入，請再試一次。' : errorMessage(e);
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
  const columns: BoardColumn[] = data.columns.map((c) => ({ id: c.id, label: c.label, title: c.label, count: c.count, cards: c.cards }));

  return (
    <div>
      {region}
      <div className="toolbar">
        <span className="muted">{rm.description}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {board.refreshing ? <Spinner label="更新中" /> : null}
          {rm.portalPublished ? <span className="chip chip-positive">已發布到前台</span> : null}
          <label className="sr-only" htmlFor="sort-mode">排序方式</label>
          <select id="sort-mode" className="select" style={{ width: 180 }} value={rm.sortMode} onChange={(e) => setSort(e.target.value as Roadmap['sortMode'])}>
            <option value="create_time">建立時間（新到舊）</option>
            <option value="freedom">自由排序</option>
          </select>
          <Button onClick={onSettings}><IconSettings />看板設定</Button>
        </span>
      </div>
      {error ? <div className="banner banner-error" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
      <Board columns={columns} accent="roadmap" onMove={move} pendingId={pendingId} onOpen={onOpen}
        cardExtra={(card) => {
          const f = card as unknown as Feedback;
          const tags = [f.category?.name, f.version ? `版本 ${f.version.name}` : null].filter(Boolean);
          return tags.length ? <div className="chips">{tags.slice(0, 2).map((t) => <span key={t} className="chip">{t}</span>)}</div> : null;
        }} />
    </div>
  );
}

function CreateRoadmapModal({ taxonomy, onClose, onCreated }: { taxonomy: Taxonomy; onClose: () => void; onCreated: (id: string) => void }) {
  const { product } = useProduct();
  const singleGroups = taxonomy.tagGroups.filter((g) => g.selectionMode === 'single');
  const multiGroups = taxonomy.tagGroups.filter((g) => g.selectionMode === 'multiple');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dimension, setDimension] = useState<'status' | 'category' | 'tag_group'>('status');
  const [groupId, setGroupId] = useState(singleGroups[0]?.id ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const submit = async () => {
    setPending(true);
    setErrors({});
    try {
      const r = await api.post(`/products/${product.id}/roadmaps`, { body: { name, description, dimension, tagGroupId: dimension === 'tag_group' ? groupId : null } });
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
      <Field label="看板名稱" required error={errors.name}>{(p) => <input {...p} className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} data-autofocus />}</Field>
      <Field label="描述" error={errors.description}>{(p) => <input {...p} className="input" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      <p className="small muted">每個選項自動成為一欄{dimension === 'tag_group' ? '，另有固定的「未歸類」欄' : ''}；不提供 AND／OR 或自訂條件。</p>
    </Modal>
  );
}

function RoadmapSettings({ roadmapId, onClose, onChanged, onDeleted, onMoveTab }: { roadmapId: string; onClose: () => void; onChanged: () => void; onDeleted: () => void; onMoveTab: (dir: -1 | 1) => Promise<void> }) {
  const { product } = useProduct();
  const board = useResource<BoardData>(`/products/${product.id}/roadmaps/${roadmapId}/board?limit=1`);
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!board.data) return <Modal title="看板設定" onClose={onClose}>{board.error ? <ErrorState message={board.error.message} /> : <LoadingState />}</Modal>;
  const rm = board.data.roadmap;
  const save = async () => {
    setPending(true);
    setError(null);
    try {
      let rev = rm.revision;
      if ((name ?? rm.name) !== rm.name || (description ?? rm.description) !== rm.description) {
        rev = (await api.patch(`/products/${product.id}/roadmaps/${rm.id}`, { body: { name: name ?? rm.name, description: description ?? rm.description, expectedRevision: rev } })).data.revision;
      }
      for (const [colId, label] of Object.entries(labels)) {
        const col = board.data!.columns.find((c) => c.id === colId)!;
        if (label.trim() && label !== col.label) rev = (await api.patch(`/products/${product.id}/roadmaps/${rm.id}/columns/${colId}`, { body: { label, expectedRevision: rev } })).data.roadmapRevision;
      }
      onChanged();
      window.dispatchEvent(new Event('csb:board-refresh'));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      void board.reload();
    } finally { setPending(false); }
  };
  const moveColumn = async (index: number, dir: -1 | 1) => {
    const ids = board.data!.columns.map((c) => c.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try {
      await api.put(`/products/${product.id}/roadmaps/${rm.id}/columns/order`, { body: { columnIds: ids, expectedRevision: rm.revision } });
      await board.reload();
      window.dispatchEvent(new Event('csb:board-refresh'));
    } catch (e) { setError(errorMessage(e)); void board.reload(); }
  };
  const publish = async (v: boolean) => {
    try {
      await api.patch(`/products/${product.id}/roadmaps/${rm.id}`, { body: { portalPublished: v, expectedRevision: rm.revision } });
      await board.reload();
      onChanged();
      window.dispatchEvent(new Event('csb:board-refresh'));
    } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <Modal title="看板設定" onClose={onClose} footer={<>
      {!rm.isDefault ? <span className="spacer"><Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>刪除看板</Button></span> : <span className="spacer small muted">預設看板不可刪除</span>}
      <Button onClick={onClose}>取消</Button><Button variant="primary" pending={pending} onClick={save}>儲存</Button>
    </>}>
      {error ? <div className="banner banner-error" role="alert">{error}</div> : null}
      <p className="small muted">分欄維度：{rm.dimension === 'tag_group' ? `Tag 群組「${rm.tagGroupName}」` : DIMENSION_LABEL[rm.dimension]}（不可修改；要換維度請另建看板）</p>
      <Field label="名稱">{(p) => <input {...p} className="input" maxLength={60} value={name ?? rm.name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="field-label">Tab 順序</span>
        <Button size="sm" onClick={() => onMoveTab(-1).catch((e) => setError(errorMessage(e)))}>往前移</Button>
        <Button size="sm" onClick={() => onMoveTab(1).catch((e) => setError(errorMessage(e)))}>往後移</Button>
      </div>
      <Field label="描述">{(p) => <input {...p} className="input" maxLength={500} value={description ?? rm.description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      {rm.dimension === 'status' ? (
        <Switch checked={rm.portalPublished} onChange={publish} label="發布到前台（只顯示公開卡片，不可拖曳）" />
      ) : <p className="small muted">第一版只有狀態看板可以發布到前台。</p>}
      <div>
        <div className="field-label" style={{ marginBottom: 6 }}>欄位顯示名稱與順序</div>
        {board.data.columns.map((c, i) => (
          <div key={c.id} className="option-row">
            <label className="sr-only" htmlFor={`col-${c.id}`}>欄位名稱</label>
            <input id={`col-${c.id}`} className="input name" maxLength={50} value={labels[c.id] ?? c.label} onChange={(e) => setLabels((l) => ({ ...l, [c.id]: e.target.value }))} />
            {c.isUnclassified ? <span className="chip">未歸類</span> : null}
            <Button size="sm" variant="ghost" aria-label={`上移「${c.label}」`} disabled={i === 0} onClick={() => moveColumn(i, -1)}>↑</Button>
            <Button size="sm" variant="ghost" aria-label={`下移「${c.label}」`} disabled={i === board.data!.columns.length - 1} onClick={() => moveColumn(i, 1)}>↓</Button>
          </div>
        ))}
        <p className="small muted" style={{ marginTop: 6 }}>欄位對應的選項由 Setting 管理；移除選項需先處理引用。</p>
      </div>
      {confirmDelete ? (
        <ConfirmModal title={`刪除看板「${rm.name}」？`} confirmLabel="刪除看板" danger onCancel={() => setConfirmDelete(false)} onConfirm={async () => {
          try { await api.del(`/products/${product.id}/roadmaps/${rm.id}`, { ifMatch: rm.revision }); onDeleted(); } catch (e) { setError(errorMessage(e)); setConfirmDelete(false); }
        }}>只刪除看板與它的排序，Feedback 及其分類完全保留。</ConfirmModal>
      ) : null}
    </Modal>
  );
}
