/**
 * Pure Schedule draft model used by the create-Feedback modal before the
 * Feedback exists. The server replays the same actions transactionally; this
 * module only previews them (the server result is authoritative).
 */
import { parseScheduleInput } from './parser';

export type DraftAction =
  | { clientActionId: string; type: 'row.add' }
  | { clientActionId: string; type: 'comment.create'; body: string; replyToClientActionId?: string | null }
  | { clientActionId: string; type: 'comment.edit'; targetClientActionId: string; body: string }
  | { clientActionId: string; type: 'history.hide'; targetClientActionId: string };

export interface DraftEntry { id: string; row: number; column: number; body: string; createdAt: string; removed: null | 'clear' | 'history_hide' }
export interface DraftComment {
  id: string; body: string; kind: 'normal' | 'command'; replyToId: string | null; createdAt: string; edited: boolean;
}
export interface DraftOperation {
  id: string; type: string; row: number | null; column: number | null; affected: string[]; targetId: string | null;
  commentId: string | null; hidden: boolean; summary: string; createdAt: string;
}
export interface DraftState { rows: number[]; entries: DraftEntry[]; comments: DraftComment[]; operations: DraftOperation[]; actions: DraftAction[] }

export function emptyDraft(): DraftState {
  return { rows: [2], entries: [], comments: [], operations: [], actions: [] };
}

export type DraftResult = { ok: true; state: DraftState; message: string } | { ok: false; message: string };

function summarize(type: string, row: number | null, column: number | null, extra: string): string {
  const coord = row !== null && column !== null ? `/${row}-${column}` : '';
  switch (type) {
    case 'row.add': return `新增第 ${row} 列`;
    case 'command.append': return `寫入 ${coord}：${extra}`;
    case 'command.clear': return `清空 ${coord}（${extra} 筆）`;
    case 'comment.create': return '新增留言';
    case 'comment.edit': return '編輯留言';
    case 'history.hide': return `移除操作紀錄：${extra}`;
    default: return type;
  }
}

export function applyDraftAction(state: DraftState, action: DraftAction, now = new Date().toISOString()): DraftResult {
  const s: DraftState = {
    rows: [...state.rows], entries: state.entries.map((e) => ({ ...e })), comments: state.comments.map((c) => ({ ...c })),
    operations: state.operations.map((o) => ({ ...o })), actions: [...state.actions, action],
  };
  const id = action.clientActionId;
  if (action.type === 'row.add') {
    const row = Math.max(...s.rows) + 1;
    s.rows.push(row);
    s.operations.push({ id, type: 'row.add', row, column: null, affected: [], targetId: null, commentId: null, hidden: false, summary: summarize('row.add', row, null, ''), createdAt: now });
    return { ok: true, state: s, message: `已新增第 ${row} 列至草稿` };
  }
  if (action.type === 'comment.create') {
    const parsed = parseScheduleInput(action.body);
    if (parsed.kind === 'error') return { ok: false, message: parsed.message };
    if (action.replyToClientActionId && !s.comments.some((c) => c.id === action.replyToClientActionId)) {
      return { ok: false, message: '找不到要回覆的留言。' };
    }
    if (parsed.kind === 'normal') {
      s.comments.push({ id, body: parsed.body, kind: 'normal', replyToId: action.replyToClientActionId ?? null, createdAt: now, edited: false });
      s.operations.push({ id, type: 'comment.create', row: null, column: null, affected: [], targetId: null, commentId: id, hidden: false, summary: summarize('comment.create', null, null, ''), createdAt: now });
      return { ok: true, state: s, message: '留言已加入草稿' };
    }
    if (action.replyToClientActionId) return { ok: false, message: '回覆為普通留言，不能執行指令。' };
    if (!s.rows.includes(parsed.row)) return { ok: false, message: `第 ${parsed.row} 列不存在。` };
    s.comments.push({ id, body: parsed.body, kind: 'command', replyToId: null, createdAt: now, edited: false });
    if (parsed.action === 'append') {
      s.entries.push({ id, row: parsed.row, column: parsed.column, body: parsed.payload, createdAt: now, removed: null });
      s.operations.push({ id, type: 'command.append', row: parsed.row, column: parsed.column, affected: [id], targetId: null, commentId: id, hidden: false, summary: summarize('command.append', parsed.row, parsed.column, parsed.payload.slice(0, 40)), createdAt: now });
      return { ok: true, state: s, message: '已套用至草稿：寫入 1 筆' };
    }
    const affected = s.entries.filter((e) => e.row === parsed.row && e.column === parsed.column && e.removed === null);
    for (const e of affected) e.removed = 'clear';
    s.operations.push({ id, type: 'command.clear', row: parsed.row, column: parsed.column, affected: affected.map((e) => e.id), targetId: null, commentId: id, hidden: false, summary: summarize('command.clear', parsed.row, parsed.column, String(affected.length)), createdAt: now });
    return { ok: true, state: s, message: `已套用至草稿：清空 ${affected.length} 筆` };
  }
  if (action.type === 'comment.edit') {
    const c = s.comments.find((x) => x.id === action.targetClientActionId);
    if (!c || c.kind !== 'normal') return { ok: false, message: '只能編輯普通留言。' };
    const body = action.body.trim();
    if (!body || body.startsWith('/')) return { ok: false, message: '編輯後仍須為普通留言。' };
    c.body = body;
    c.edited = true;
    s.operations.push({ id, type: 'comment.edit', row: null, column: null, affected: [], targetId: null, commentId: c.id, hidden: false, summary: summarize('comment.edit', null, null, ''), createdAt: now });
    return { ok: true, state: s, message: '已更新草稿留言' };
  }
  // history.hide
  const target = s.operations.find((o) => o.id === action.targetClientActionId);
  if (!target || target.hidden) return { ok: false, message: '找不到可移除的操作紀錄。' };
  target.hidden = true;
  if (target.type === 'command.append') {
    for (const e of s.entries) if (e.id === target.affected[0] && e.removed === null) e.removed = 'history_hide';
  }
  // clear / row.add / comment / history.hide: only hidden, nothing restored
  s.operations.push({ id, type: 'history.hide', row: null, column: null, affected: [], targetId: target.id, commentId: null, hidden: false, summary: summarize('history.hide', null, null, target.summary), createdAt: now });
  return { ok: true, state: s, message: '已從草稿移除操作紀錄' };
}
