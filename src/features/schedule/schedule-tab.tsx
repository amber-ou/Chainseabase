'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage, newKey } from '@/client/api';
import { relativeTime, ymd, formatDateTime } from '@/client/format';
import type { Me } from '@/client/site';
import { Avatar, Button, ErrorState, LoadingState, useAnnouncer } from '@/components/ui';
import { ConfirmModal } from '@/components/modal';
import { Tabs } from '@/components/tabs';
import { IconAlert, IconCheck, IconHeart, IconPlus, IconReply, IconTrash } from '@/components/icons';
import { coordinate, parseScheduleInput, retargetInput, SCHEDULE_COLUMNS } from '@/modules/schedule/parser';
import { applyDraftAction, type DraftState } from '@/modules/schedule/draft';
import type { CommentItem } from '@/features/feedback/types';

interface Entry { id: string; body: string; createdAt: string | null; author: { id: string; displayName: string; avatarUrl: string | null } }
interface Row { id: string; displayRow: number; cells: Entry[][] }
interface HistoryItem { id: string; type: string; actor: { id: string; displayName: string; avatarUrl: string | null } | null; coordinate: string | null; summary: string; affectedCount: number; createdAt: string | null }
type Result = { kind: 'success' | 'draft' | 'error'; text: string } | null;

const HIDE_CONSEQUENCE: Record<string, string> = {
  'command.append': '只移除這次寫入建立的項目，同一格的其他內容保留。若該內容已被清空，資料不會再改變。',
  'command.clear': '只隱藏這筆紀錄，已清空的內容不會恢復。',
  'row.add': '只隱藏這筆紀錄，列與內容保留，座標不會移動。',
  'comment.create': '只隱藏這筆紀錄，不會刪除或恢復留言。',
  'comment.edit': '只隱藏這筆紀錄，留言內容維持目前版本。',
  'comment.delete': '只隱藏這筆紀錄，不會恢復已移除的留言。',
  'comment.like': '只隱藏這筆紀錄，按讚狀態不變。',
  'comment.unlike': '只隱藏這筆紀錄，按讚狀態不變。',
  'history.hide': '只隱藏這筆紀錄，先前移除的結果不會恢復。',
};

function ScheduleTable({ rows, selected, onSelect }: { rows: Row[]; selected: { row: number; col: number } | null; onSelect: (row: number, col: number) => void }) {
  return (
    <div className="schedule-scroll">
      <table className="schedule-table">
        <caption className="sr-only">Schedule：表頭為第 1 列，內容從第 2 列開始</caption>
        <thead>
          <tr>
            <th scope="col" className="row-head"><span className="sr-only">列</span>1</th>
            {SCHEDULE_COLUMNS.map((c, i) => <th key={c} scope="col">{c}<span className="sr-only">（第 {i + 1} 欄）</span></th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="row-head num">{r.displayRow}</th>
              {r.cells.map((entries, i) => {
                const col = i + 1;
                const isSel = selected?.row === r.displayRow && selected.col === col;
                return (
                  <td key={col}>
                    <button type="button" className="cell-btn" aria-pressed={isSel} aria-label={`第 ${r.displayRow} 列，${SCHEDULE_COLUMNS[i]}，${entries.length} 筆內容`} onClick={() => onSelect(r.displayRow, col)}>
                      {entries.map((e) => (
                        <span key={e.id} className="entry">
                          <span className="entry-head"><Avatar name={e.author.displayName} url={e.author.avatarUrl} id={e.author.id} size={24} />{e.author.displayName}</span>
                          <span className="entry-body">{e.body}</span>
                          <span className="small muted num">{e.createdAt ? ymd(e.createdAt) : '草稿'}</span>
                        </span>
                      ))}
                      <span className="cell-hint">{isSel ? `已選取 ${coordinate(r.displayRow, col)}` : `填寫 ${coordinate(r.displayRow, col)}`}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Composer({ value, setValue, onSubmit, pending, result, inputRef, replyTo, onCancelReply }: {
  value: string; setValue: (v: string) => void; onSubmit: () => void; pending: boolean; result: Result;
  inputRef: React.RefObject<HTMLTextAreaElement | null>; replyTo: { author: string; excerpt: string } | null; onCancelReply: () => void;
}) {
  const parsed = value.trim() ? parseScheduleInput(value) : null;
  return (
    <div className="composer">
      {replyTo ? <div className="quote" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>回覆 @{replyTo.author}：{replyTo.excerpt}</span><Button size="sm" variant="ghost" onClick={onCancelReply}>取消回覆</Button></div> : null}
      <div className="small muted">
        {parsed?.kind === 'command' ? <>目標 <strong className="mono">{coordinate(parsed.row, parsed.column)}</strong>（{SCHEDULE_COLUMNS[parsed.column - 1]}）· {parsed.action === 'clear' ? '將清空此格' : '將寫入此格'}</> : '點選表格的格子帶入座標，或直接輸入「/列-欄 內容」；不是 / 開頭的內容會成為一般 Schedule 留言。'}
      </div>
      <label className="sr-only" htmlFor="schedule-input">Schedule 留言或指令</label>
      <textarea id="schedule-input" ref={inputRef} className="textarea" rows={3} maxLength={5000} value={value} placeholder="/2-3 填寫內容…"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSubmit(); } }} />
      <div className="composer-foot">
        <span aria-live="polite">
          {result ? (
            <span className="cmd-result" data-kind={result.kind}>{result.kind === 'error' ? <IconAlert /> : <IconCheck />}{result.text}</span>
          ) : <span className="small muted">Enter 換行，Ctrl/⌘ + Enter 送出 · 內部範圍，前台不可見</span>}
        </span>
        <Button variant="primary" pending={pending} onClick={onSubmit}>送出</Button>
      </div>
    </div>
  );
}

function useCellTargeting(value: string, setValue: (v: string) => void, inputRef: React.RefObject<HTMLTextAreaElement | null>) {
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [confirmConvert, setConfirmConvert] = useState<{ row: number; col: number; next: string } | null>(null);
  const select = (row: number, col: number) => {
    setSelected({ row, col });
    const r = retargetInput(value, row, col);
    if (r.needsConfirm) {
      // never overwrite a normal comment silently
      setConfirmConvert({ row, col, next: r.value });
      return;
    }
    setValue(r.value);
    setTimeout(() => {
      inputRef.current?.focus();
      const len = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(len, len);
    }, 0);
  };
  const dialog = confirmConvert ? (
    <ConfirmModal title="輸入框已有一般留言" confirmLabel={`轉為 ${coordinate(confirmConvert.row, confirmConvert.col)} 指令`} onCancel={() => { setConfirmConvert(null); inputRef.current?.focus(); }}
      onConfirm={() => { setValue(confirmConvert.next); setConfirmConvert(null); setTimeout(() => inputRef.current?.focus(), 0); }}>
      要把目前的文字轉為寫入 {coordinate(confirmConvert.row, confirmConvert.col)} 的指令嗎？選擇取消會保留原文，你也可以先送出這則一般留言。
    </ConfirmModal>
  ) : null;
  return { selected, setSelected, select, dialog };
}

function HistoryList({ items, onHide }: { items: HistoryItem[]; onHide: (h: HistoryItem) => void }) {
  if (items.length === 0) return <p className="muted">還沒有操作紀錄。</p>;
  return (
    <div>
      {items.map((h) => (
        <div key={h.id} className="history-row">
          <Avatar name={h.actor?.displayName ?? ''} url={h.actor?.avatarUrl} id={h.actor?.id} size={24} />
          <div className="summary">
            <div><strong>{h.actor?.displayName ?? '我'}</strong> · {h.summary}</div>
            <div className="small muted" title={h.createdAt ? formatDateTime(h.createdAt) : '尚未送出'}>{h.createdAt ? relativeTime(h.createdAt) : '草稿'}</div>
          </div>
          <Button size="sm" variant="ghost" aria-label={`移除操作紀錄：${h.summary}`} title="移除操作紀錄" onClick={() => onHide(h)}><IconTrash /></Button>
        </div>
      ))}
    </div>
  );
}

function CommentList({ items, onReply, onLike, onEdit }: {
  items: CommentItem[]; onReply: (c: CommentItem) => void; onLike?: (c: CommentItem) => void; onEdit?: (c: CommentItem, body: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  if (items.length === 0) return <p className="muted">還沒有 Schedule 留言。</p>;
  return (
    <div>
      {items.map((c) => (
        <article key={c.id} className="comment">
          <Avatar name={c.author.displayName} url={c.author.avatarUrl} id={c.author.id} size={28} />
          <div className="comment-body">
            <div className="comment-head">
              <strong>{c.author.displayName}</strong>
              <span className="small muted">{c.createdAt ? relativeTime(c.createdAt) : '草稿'}</span>
              {c.kind === 'command' ? <span className="chip chip-outline mono">指令</span> : null}
              {c.command?.historyRemoved ? <span className="chip chip-warning">操作紀錄已移除</span> : null}
              {c.command?.contentCleared ? <span className="chip">內容已清空</span> : null}
              {c.editedAt ? <span className="small muted">（已編輯）</span> : null}
            </div>
            {c.replyTo ? <div className="quote">@{c.replyTo.author}：{c.replyTo.removed ? '原留言已移除' : c.replyTo.excerpt}</div> : null}
            {editing?.id === c.id && onEdit ? (
              <div className="composer">
                <label className="sr-only" htmlFor={`sedit-${c.id}`}>編輯留言</label>
                <textarea id={`sedit-${c.id}`} className="textarea" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button size="sm" variant="primary" onClick={async () => { await onEdit(c, editing.body); setEditing(null); }}>儲存</Button>
                  <Button size="sm" onClick={() => setEditing(null)}>取消</Button>
                </div>
              </div>
            ) : <p className={c.kind === 'command' ? 'mono' : ''} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.body}</p>}
            <div className="comment-actions">
              {c.kind === 'normal' && onLike ? (
                <Button size="sm" variant="ghost" aria-pressed={c.likedByMe} aria-label={`${c.likedByMe ? '收回讚' : '按讚'}，目前 ${c.likeCount} 個讚`} onClick={() => onLike(c)}><IconHeart filled={c.likedByMe} />{c.likeCount}</Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => onReply(c)}><IconReply />回覆</Button>
              {c.kind === 'normal' && onEdit ? <Button size="sm" variant="ghost" onClick={() => setEditing({ id: c.id, body: c.body })}>編輯</Button> : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft mode (Feedback not created yet): everything stays in the modal
// ---------------------------------------------------------------------------

export function ScheduleDraftTab({ draft, onChange, me }: { draft: DraftState; onChange: (d: DraftState) => void; me: Me | null }) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<Result>(null);
  const [sub, setSub] = useState('comments');
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [hiding, setHiding] = useState<HistoryItem | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { announce, region } = useAnnouncer();
  const targeting = useCellTargeting(value, setValue, inputRef);
  const author = { id: me?.id ?? 'me', displayName: me?.displayName ?? '我', avatarUrl: me?.avatarUrl ?? null };
  const rows: Row[] = draft.rows.map((n) => ({
    id: `draft-row-${n}`, displayRow: n,
    cells: [1, 2, 3, 4, 5].map((col) => draft.entries.filter((e) => e.row === n && e.column === col && e.removed === null).map((e) => ({ id: e.id, body: e.body, createdAt: null, author }))),
  }));
  const apply = (action: Parameters<typeof applyDraftAction>[1]) => {
    const r = applyDraftAction(draft, action);
    if (!r.ok) {
      setResult({ kind: 'error', text: r.message });
      announce(r.message);
      return false;
    }
    onChange(r.state);
    setResult({ kind: 'draft', text: r.message });
    announce(r.message);
    return true;
  };
  const submit = () => {
    if (apply({ clientActionId: newKey(), type: 'comment.create', body: value, replyToClientActionId: replyTo?.id ?? null })) {
      setValue('');
      setReplyTo(null);
    }
  };
  const comments: CommentItem[] = draft.comments.map((c) => {
    const op = draft.operations.find((o) => o.commentId === c.id && (o.type === 'command.append' || o.type === 'command.clear'));
    const parent = c.replyToId ? draft.comments.find((x) => x.id === c.replyToId) : null;
    return {
      id: c.id, feedbackId: '', stream: 'schedule', kind: c.kind, body: c.body, author, createdAt: '', editedAt: c.edited ? 'draft' : null, revision: 1,
      likeCount: 0, likedByMe: false,
      replyTo: parent ? { id: parent.id, author: author.displayName, excerpt: parent.body.slice(0, 120), removed: false } : null,
      command: op ? { operationId: op.id, action: op.type === 'command.clear' ? 'clear' : 'append', coordinate: `/${op.row}-${op.column}`, historyRemoved: op.hidden, contentCleared: draft.entries.find((e) => e.id === op.affected[0])?.removed === 'clear', affectedCount: op.affected.length } : null,
    };
  });
  const history: HistoryItem[] = [...draft.operations].filter((o) => !o.hidden).reverse().map((o) => ({ id: o.id, type: o.type, actor: author, coordinate: null, summary: o.summary, affectedCount: o.affected.length, createdAt: null }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {region}
      <div className="banner banner-info small">草稿模式：所有 Schedule 動作會在建立 Feedback 時一次送出；尚未儲存到伺服器。</div>
      <ScheduleTable rows={rows} selected={targeting.selected} onSelect={targeting.select} />
      <div><Button size="sm" onClick={() => apply({ clientActionId: newKey(), type: 'row.add' })}><IconPlus />新增一排</Button></div>
      <Tabs label="Schedule 留言與歷史" value={sub} onChange={setSub} tabs={[{ id: 'comments', label: '留言區' }, { id: 'history', label: '操作歷史紀錄' }]}>
        {sub === 'comments' ? (
          <CommentList items={comments} onReply={(c) => { setReplyTo(c); inputRef.current?.focus(); }}
            onEdit={async (c, body) => { apply({ clientActionId: newKey(), type: 'comment.edit', targetClientActionId: c.id, body }); }} />
        ) : <HistoryList items={history} onHide={setHiding} />}
      </Tabs>
      <Composer value={value} setValue={(v) => { setValue(v); setResult(null); }} onSubmit={submit} pending={false} result={result} inputRef={inputRef}
        replyTo={replyTo ? { author: author.displayName, excerpt: replyTo.body.slice(0, 60) } : null} onCancelReply={() => setReplyTo(null)} />
      {targeting.dialog}
      {hiding ? (
        <ConfirmModal title="移除這筆操作紀錄？" confirmLabel="移除紀錄" danger onCancel={() => setHiding(null)} onConfirm={() => { apply({ clientActionId: newKey(), type: 'history.hide', targetClientActionId: hiding.id }); setHiding(null); }}>
          <p><strong>{hiding.summary}</strong></p>
          <p>{HIDE_CONSEQUENCE[hiding.type] ?? '只隱藏這筆紀錄。'}</p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live mode: every action is an atomic server transaction
// ---------------------------------------------------------------------------

export function ScheduleLiveTab({ productId, feedbackId }: { productId: string; feedbackId: string }) {
  const base = `/products/${productId}/feedback/${feedbackId}/schedule`;
  const [schedule, setSchedule] = useState<{ revision: number; rows: Row[] } | null>(null);
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [result, setResult] = useState<Result>(null);
  const [pending, setPending] = useState(false);
  const [sub, setSub] = useState('comments');
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [hiding, setHiding] = useState<HistoryItem | null>(null);
  const [hidePending, setHidePending] = useState(false);
  const [hideError, setHideError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { announce, region } = useAnnouncer();
  const targeting = useCellTargeting(value, (v) => { keyRef.current = null; setValue(v); }, inputRef);

  const load = useCallback(async () => {
    try {
      const [s, c, h] = await Promise.all([api.get(base), api.get(`${base}/comments?limit=100`), api.get(`${base}/history?limit=100`)]);
      setSchedule(s.data);
      setComments(c.data);
      setHistory(h.data);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  if (loadError && !schedule) return <ErrorState message={loadError} onRetry={load} />;
  if (!schedule || !comments || !history) return <LoadingState />;

  const submit = async () => {
    const parsed = parseScheduleInput(value);
    if (parsed.kind === 'error') { setResult({ kind: 'error', text: parsed.message }); announce(parsed.message); return; }
    keyRef.current ??= newKey();
    setPending(true);
    try {
      const r = await api.post(`${base}/comments`, { key: keyRef.current, body: { body: value, replyToId: replyTo?.id ?? null, expectedRevision: schedule.revision } });
      keyRef.current = null;
      setSchedule(r.data.schedule);
      const text = r.data.action === 'append' ? `已寫入 1 筆至 ${r.data.comment.command.coordinate}` : r.data.action === 'clear' ? `已清空 ${r.data.affectedCount} 筆（${r.data.comment.command.coordinate}）` : '已送出留言';
      setResult({ kind: 'success', text });
      announce(text);
      setValue('');
      setReplyTo(null);
      void load();
    } catch (e) {
      // keep the text and the selected cell; reload on conflict so the user can resend
      const msg = e instanceof ApiError && e.status === 409 ? '內容已被其他人更新，已重新載入表格；請確認後再送出。' : errorMessage(e);
      setResult({ kind: 'error', text: msg });
      announce(msg);
      if (e instanceof ApiError && e.status === 409) { keyRef.current = null; void load(); }
    } finally {
      setPending(false);
    }
  };
  const addRow = async () => {
    try {
      const r = await api.post(`${base}/rows`, { body: { expectedRevision: schedule.revision } });
      announce(`已新增第 ${r.data.row.displayRow} 列`);
      setResult({ kind: 'success', text: `已新增第 ${r.data.row.displayRow} 列` });
    } catch (e) {
      setResult({ kind: 'error', text: errorMessage(e) });
    }
    void load();
  };
  const hide = async () => {
    if (!hiding) return;
    setHidePending(true);
    setHideError(null);
    try {
      await api.del(`${base}/history/${hiding.id}`, { ifMatch: schedule.revision });
      setHiding(null);
      announce('已移除操作紀錄');
      void load();
    } catch (e) {
      setHideError(e instanceof ApiError && e.status === 409 ? '內容已更新，已重新載入，請再確認一次。' : errorMessage(e));
      void load();
    } finally {
      setHidePending(false);
    }
  };
  const like = async (c: CommentItem) => {
    try {
      if (c.likedByMe) await api.del(`/products/${productId}/comments/${c.id}/like`);
      else await api.put(`/products/${productId}/comments/${c.id}/like`);
    } catch (e) { setResult({ kind: 'error', text: errorMessage(e) }); }
    void load();
  };
  const edit = async (c: CommentItem, body: string) => {
    try {
      await api.patch(`/products/${productId}/comments/${c.id}`, { body: { body, expectedRevision: c.revision, expectedScheduleRevision: schedule.revision } });
    } catch (e) { setResult({ kind: 'error', text: errorMessage(e) }); }
    void load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {region}
      <ScheduleTable rows={schedule.rows} selected={targeting.selected} onSelect={targeting.select} />
      <div><Button size="sm" onClick={addRow}><IconPlus />新增一排</Button></div>
      <Tabs label="Schedule 留言與歷史" value={sub} onChange={setSub} tabs={[{ id: 'comments', label: `留言區（${comments.length}）` }, { id: 'history', label: '操作歷史紀錄' }]}>
        {sub === 'comments' ? (
          <CommentList items={comments} onReply={(c) => { setReplyTo(c); inputRef.current?.focus(); }} onLike={like} onEdit={edit} />
        ) : <HistoryList items={history} onHide={(h) => { setHideError(null); setHiding(h); }} />}
      </Tabs>
      <Composer value={value} setValue={(v) => { keyRef.current = null; setValue(v); setResult(null); }} onSubmit={submit} pending={pending} result={result} inputRef={inputRef}
        replyTo={replyTo ? { author: replyTo.author.displayName, excerpt: replyTo.body.slice(0, 60) } : null} onCancelReply={() => setReplyTo(null)} />
      {targeting.dialog}
      {hiding ? (
        <ConfirmModal title="移除這筆操作紀錄？" confirmLabel="移除紀錄" danger pending={hidePending} error={hideError} onCancel={() => setHiding(null)} onConfirm={hide}>
          <p><strong>{hiding.summary}</strong></p>
          <p>{HIDE_CONSEQUENCE[hiding.type] ?? '只隱藏這筆紀錄。'}</p>
          <p className="small muted">移除本身也會留下一筆「移除操作紀錄」，原留言會保留並標示「操作紀錄已移除」。</p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
