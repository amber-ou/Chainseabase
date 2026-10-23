import { describe, expect, it } from 'vitest';
import { parseScheduleInput, retargetInput } from '@/modules/schedule/parser';
import { applyDraftAction, emptyDraft, type DraftState } from '@/modules/schedule/draft';

describe('schedule command grammar', () => {
  it('parses append and exact-lowercase delete', () => {
    expect(parseScheduleInput('  /2-3   完成搜尋欄位  ')).toEqual({ kind: 'command', body: '/2-3   完成搜尋欄位', row: 2, column: 3, action: 'append', payload: '完成搜尋欄位' });
    expect(parseScheduleInput('/2-3 delete')).toMatchObject({ action: 'clear' });
    expect(parseScheduleInput('/2-3 delete ')).toMatchObject({ action: 'clear' });
    expect(parseScheduleInput('/2-3 Delete')).toMatchObject({ action: 'append', payload: 'Delete' });
    expect(parseScheduleInput('/2-3 delete all')).toMatchObject({ action: 'append', payload: 'delete all' });
    expect(parseScheduleInput('/10-5 多行\n第二行')).toMatchObject({ row: 10, column: 5, payload: '多行\n第二行' });
  });
  it('rejects malformed commands instead of downgrading to a comment', () => {
    for (const s of ['/1-3 表頭', '/2-6 x', '/2-0 x', '/0-1 x', '/02-3 x', '/2-03 x', '/2-3', '/2-3   ', '/2-3x y', '/a-b x', '/', '/2 3 x', '/-1-2 x']) {
      expect(parseScheduleInput(s).kind, s).toBe('error');
    }
    expect(parseScheduleInput('/1-3 x')).toMatchObject({ code: 'INVALID_COORDINATE' });
    expect(parseScheduleInput('   ')).toMatchObject({ code: 'EMPTY' });
    expect(parseScheduleInput('x'.repeat(5001))).toMatchObject({ code: 'TOO_LONG' });
  });
  it('normal text is a normal comment, including text mentioning /2-3 later', () => {
    expect(parseScheduleInput('請看 /2-3')).toEqual({ kind: 'normal', body: '請看 /2-3' });
    expect(parseScheduleInput('操作：delete')).toEqual({ kind: 'normal', body: '操作：delete' });
  });
  it('clicking a cell replaces only the coordinate of an existing command', () => {
    expect(retargetInput('', 2, 3)).toEqual({ value: '/2-3 ', needsConfirm: false });
    expect(retargetInput('/2-1 已輸入的內容', 3, 4)).toEqual({ value: '/3-4 已輸入的內容', needsConfirm: false });
    expect(retargetInput('一般留言文字', 2, 2)).toEqual({ value: '/2-2 一般留言文字', needsConfirm: true });
  });
});

describe('schedule draft reducer (create modal preview)', () => {
  const run = (actions: Parameters<typeof applyDraftAction>[1][]) => {
    let s: DraftState = emptyDraft();
    const messages: string[] = [];
    for (const a of actions) {
      const r = applyDraftAction(s, a, '2026-10-23T00:00:00.000Z');
      if (!r.ok) throw new Error(r.message);
      s = r.state;
      messages.push(r.message);
    }
    return { s, messages };
  };
  it('mirrors append / clear / hide semantics and never restores cleared entries', () => {
    const { s, messages } = run([
      { clientActionId: 'a', type: 'comment.create', body: '/2-3 甲' },
      { clientActionId: 'b', type: 'comment.create', body: '/2-3 乙' },
      { clientActionId: 'c', type: 'comment.create', body: '/2-3 delete' },
      { clientActionId: 'd', type: 'history.hide', targetClientActionId: 'c' },
      { clientActionId: 'e', type: 'comment.create', body: '/2-3 丙' },
      { clientActionId: 'f', type: 'history.hide', targetClientActionId: 'a' },
    ]);
    expect(messages[0]).toBe('已套用至草稿：寫入 1 筆');
    expect(messages[2]).toBe('已套用至草稿：清空 2 筆');
    expect(s.entries.filter((e) => e.removed === null).map((e) => e.body)).toEqual(['丙']);
    expect(s.entries.find((e) => e.id === 'a')!.removed).toBe('clear');
  });
  it('rejects invalid actions without changing state', () => {
    const s = emptyDraft();
    expect(applyDraftAction(s, { clientActionId: 'x', type: 'comment.create', body: '/3-1 x' })).toMatchObject({ ok: false });
    expect(applyDraftAction(s, { clientActionId: 'x', type: 'history.hide', targetClientActionId: 'nope' })).toMatchObject({ ok: false });
    const r = applyDraftAction(s, { clientActionId: 'r', type: 'row.add' });
    expect(r.ok && r.state.rows).toEqual([2, 3]);
    expect(s.rows).toEqual([2]);
  });
});
