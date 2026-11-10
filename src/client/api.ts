'use client';

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors: Record<string, string>;
  retryable: boolean;
  requestId: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
  get code() { return this.body.code; }
  get isConflict() { return this.status === 409; }
  get isAuth() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
  get isNotFound() { return this.status === 404; }
}

export interface ApiResponse<T> { data: T; meta: Record<string, any>; status: number }

export function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface RequestOpts {
  body?: unknown;
  /** Idempotency key: pass the same key when retrying the same operation. */
  key?: string;
  ifMatch?: number | string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  rawBody?: BodyInit;
}

export async function request<T = any>(method: string, path: string, opts: RequestOpts = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.key) headers['idempotency-key'] = opts.key;
  if (opts.ifMatch !== undefined) headers['if-match'] = typeof opts.ifMatch === 'number' ? `"${opts.ifMatch}"` : opts.ifMatch;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, { code: 'NETWORK', message: '網路連線失敗，請檢查連線後重試。', fieldErrors: {}, retryable: true, requestId: '' });
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    throw new ApiError(res.status, json?.error ?? { code: 'INTERNAL', message: '發生未預期的錯誤。', fieldErrors: {}, retryable: res.status >= 500, requestId: '' });
  }
  return { data: json?.data as T, meta: json?.meta ?? {}, status: res.status };
}

export const api = {
  get: <T = any>(p: string, o?: RequestOpts) => request<T>('GET', p, o),
  post: <T = any>(p: string, o?: RequestOpts) => request<T>('POST', p, o),
  patch: <T = any>(p: string, o?: RequestOpts) => request<T>('PATCH', p, o),
  put: <T = any>(p: string, o?: RequestOpts) => request<T>('PUT', p, o),
  del: <T = any>(p: string, o?: RequestOpts) => request<T>('DELETE', p, o),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return '發生未預期的錯誤，請稍後再試。';
}
