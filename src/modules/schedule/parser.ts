/**
 * Schedule command grammar (shared by server and client preview).
 *
 *   /列-欄 內容      append an entry
 *   /列-欄 delete    clear the cell (payload must be exactly lowercase "delete")
 *
 * Input is trimmed first. Anything starting with "/" must be a valid command;
 * it is never downgraded to a normal comment.
 */

export const SCHEDULE_COLUMNS = ['PO', 'UIUX', '前端', '後端', 'QA'] as const;
export const MAX_COMMENT_LENGTH = 5000;

export type ParsedScheduleInput =
  | { kind: 'normal'; body: string }
  | { kind: 'command'; body: string; row: number; column: number; action: 'append' | 'clear'; payload: string }
  | { kind: 'error'; code: 'EMPTY' | 'TOO_LONG' | 'INVALID_COMMAND' | 'INVALID_COORDINATE'; message: string };

const COMMAND_RE = /^\/(\d+)-(\d+)(?:(\s+)([\s\S]*))?$/;
const POSITIVE_INT = /^[1-9]\d*$/;

export function parseScheduleInput(raw: string): ParsedScheduleInput {
  const body = raw.trim();
  if (body.length === 0) return { kind: 'error', code: 'EMPTY', message: '留言不可空白。' };
  if ([...body].length > MAX_COMMENT_LENGTH) return { kind: 'error', code: 'TOO_LONG', message: `留言最多 ${MAX_COMMENT_LENGTH} 字。` };
  if (!body.startsWith('/')) return { kind: 'normal', body };
  const m = COMMAND_RE.exec(body);
  if (!m) return { kind: 'error', code: 'INVALID_COMMAND', message: '指令格式應為「/列-欄 內容」，例如 /2-3 完成搜尋欄位。' };
  const [, rowStr, colStr, , rest] = m;
  if (!POSITIVE_INT.test(rowStr) || !POSITIVE_INT.test(colStr)) {
    return { kind: 'error', code: 'INVALID_COORDINATE', message: '列與欄必須是正整數。' };
  }
  const row = Number(rowStr);
  const column = Number(colStr);
  if (column < 1 || column > 5) return { kind: 'error', code: 'INVALID_COORDINATE', message: '欄位必須是 1–5（PO、UIUX、前端、後端、QA）。' };
  if (row === 1) return { kind: 'error', code: 'INVALID_COORDINATE', message: '第 1 列是表頭，不能作為指令目標。' };
  const payload = (rest ?? '').trim();
  if (payload.length === 0) return { kind: 'error', code: 'INVALID_COMMAND', message: '座標後需要空白與內容。' };
  return { kind: 'command', body, row, column, action: payload === 'delete' ? 'clear' : 'append', payload };
}

export function coordinate(row: number, column: number): string {
  return `/${row}-${column}`;
}

/** Replace only the coordinate of an existing valid command, keep the payload. */
export function retargetInput(current: string, row: number, column: number): { value: string; needsConfirm: boolean } {
  const trimmed = current.trim();
  const coord = coordinate(row, column);
  if (trimmed.length === 0) return { value: `${coord} `, needsConfirm: false };
  const m = /^\/\d+-\d+(\s+[\s\S]*)?$/.exec(trimmed);
  if (m) return { value: `${coord}${m[1] ?? ' '}`, needsConfirm: false };
  // plain comment text would be overwritten: caller must ask first
  return { value: `${coord} ${trimmed}`, needsConfirm: true };
}
