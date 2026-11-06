export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'AUTH_REQUIRED'
  | 'ACTION_FORBIDDEN'
  | 'NOT_A_MEMBER'
  | 'CALENDAR_ACCESS_DENIED'
  | 'CALENDAR_READ_ONLY'
  | 'CALENDAR_REAUTH_REQUIRED'
  | 'CALENDAR_NOT_CONNECTED'
  | 'CALENDAR_NOT_BOUND'
  | 'CALENDAR_WRONG_ACCOUNT'
  | 'CALENDAR_SCOPES_MISSING'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REFERENCE_IN_USE'
  | 'LAST_TEAM_MEMBER'
  | 'EVENT_CONFLICT'
  | 'DATA_INCONSISTENCY'
  | 'INVALID_COORDINATE'
  | 'INVALID_COMMAND'
  | 'SINGLE_SELECT_CONFLICT'
  | 'UNSUPPORTED_RECURRENCE'
  | 'UNSUPPORTED_EVENT_TYPE'
  | 'INVITATION_INVALID'
  | 'INVITATION_EMAIL_MISMATCH'
  | 'REVISION_REQUIRED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'MUTATION_UNCONFIRMED'
  | 'NOT_CONFIGURED'
  | 'INTERNAL';

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  AUTH_REQUIRED: 401,
  ACTION_FORBIDDEN: 403,
  NOT_A_MEMBER: 403,
  CALENDAR_ACCESS_DENIED: 403,
  CALENDAR_READ_ONLY: 403,
  CALENDAR_REAUTH_REQUIRED: 403,
  CALENDAR_NOT_CONNECTED: 403,
  CALENDAR_NOT_BOUND: 409,
  CALENDAR_WRONG_ACCOUNT: 403,
  CALENDAR_SCOPES_MISSING: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  REFERENCE_IN_USE: 409,
  LAST_TEAM_MEMBER: 409,
  EVENT_CONFLICT: 409,
  DATA_INCONSISTENCY: 409,
  INVALID_COORDINATE: 422,
  INVALID_COMMAND: 422,
  SINGLE_SELECT_CONFLICT: 422,
  UNSUPPORTED_RECURRENCE: 422,
  UNSUPPORTED_EVENT_TYPE: 422,
  INVITATION_INVALID: 410,
  INVITATION_EMAIL_MISMATCH: 403,
  REVISION_REQUIRED: 428,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 503,
  MUTATION_UNCONFIRMED: 202,
  NOT_CONFIGURED: 503,
  INTERNAL: 500,
};

const DEFAULT_MESSAGES: Partial<Record<ErrorCode, string>> = {
  INVALID_REQUEST: '請求內容無效。',
  AUTH_REQUIRED: '請先使用 Google 登入。',
  ACTION_FORBIDDEN: '你沒有執行此操作的權限。',
  NOT_A_MEMBER: '此帳號尚未受邀參與這個產品。',
  NOT_FOUND: '找不到內容，可能已移除或你沒有權限。',
  REVISION_CONFLICT: '內容已被更新，請重新載入後再操作。',
  IDEMPOTENCY_CONFLICT: '相同的操作識別碼已用於不同內容。',
  REFERENCE_IN_USE: '此項目仍被使用，請先處理引用。',
  LAST_TEAM_MEMBER: '必須保留至少一位團隊成員。',
  REVISION_REQUIRED: '缺少版本資訊，請重新載入後再操作。',
  UPSTREAM_UNAVAILABLE: '外部服務暫時無法使用，請稍後再試。',
  INTERNAL: '發生未預期的錯誤，請稍後再試。',
  EVENT_CONFLICT: '活動已在 Google 日曆被更新，請載入最新內容後再編輯。',
  DATA_INCONSISTENCY: '資料一致性錯誤，已停止此操作。',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors: Record<string, string>;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(
    code: ErrorCode,
    message?: string,
    opts: { fieldErrors?: Record<string, string>; retryable?: boolean; details?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ) {
    super(message ?? DEFAULT_MESSAGES[code] ?? code);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fieldErrors = opts.fieldErrors ?? {};
    this.retryable = opts.retryable ?? (this.status === 429 || this.status >= 502);
    this.details = opts.details;
    this.headers = opts.headers;
  }
}

export const notFound = (message?: string) => new AppError('NOT_FOUND', message);
export const forbidden = (message?: string) => new AppError('ACTION_FORBIDDEN', message);
export const invalid = (message: string, fieldErrors?: Record<string, string>) =>
  new AppError('INVALID_REQUEST', message, { fieldErrors });
export const conflict = (message?: string, details?: Record<string, unknown>) =>
  new AppError('REVISION_CONFLICT', message, { details });

export function assertRevision(actual: number, expected: number | undefined | null) {
  if (expected === undefined || expected === null) throw new AppError('REVISION_REQUIRED');
  if (actual !== expected) throw conflict();
}
