import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, invalid } from './errors';
import { getConfig, originForSite, siteForHost, type Site } from './config';
import { loadSession, type SessionUser } from './session';
import { logError, logInfo } from './log';
import { jobCollector } from './jobs-context';
import { processJobs } from './jobs';

export interface Ctx {
  req: Request;
  url: URL;
  method: string;
  site: Site;
  requestId: string;
  params: Record<string, string>;
  user: SessionUser | null;
  sessionHash: string | null;
  routePattern: string;
  /** Raw parsed JSON body (cached). */
  rawBody(): Promise<unknown>;
  body<T extends z.ZodType>(schema: T): Promise<z.infer<T>>;
  query<T extends z.ZodType>(schema: T): z.infer<T>;
  header(name: string): string | null;
  idempotencyKey(required: boolean): string | null;
  ifMatchRevision(): number;
  /** Extra Set-Cookie headers to append to the response. */
  cookies: string[];
}

export type HandlerResult = Response | { status?: number; data: unknown; meta?: Record<string, unknown> };
export type Handler = (ctx: Ctx) => Promise<HandlerResult>;

interface Route {
  method: string;
  pattern: string;
  segments: string[];
  sites: Site[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, sites: Site[], handler: Handler) {
    this.routes.push({ method, pattern, segments: pattern.split('/').filter(Boolean), sites, handler });
  }
  get(p: string, s: Site[], h: Handler) { this.add('GET', p, s, h); }
  post(p: string, s: Site[], h: Handler) { this.add('POST', p, s, h); }
  patch(p: string, s: Site[], h: Handler) { this.add('PATCH', p, s, h); }
  put(p: string, s: Site[], h: Handler) { this.add('PUT', p, s, h); }
  delete(p: string, s: Site[], h: Handler) { this.add('DELETE', p, s, h); }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | 'method' | null {
    const parts = path.split('/').filter(Boolean).map((p) => {
      try { return decodeURIComponent(p); } catch { return p; }
    });
    let pathMatched = false;
    // static segments take precedence over params: sort by number of params
    const candidates = this.routes
      .filter((r) => r.segments.length === parts.length)
      .sort((a, b) => paramCount(a) - paramCount(b));
    for (const r of candidates) {
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.segments.length; i++) {
        const seg = r.segments[i];
        if (seg.startsWith(':')) params[seg.slice(1)] = parts[i];
        else if (seg !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { route: r, params };
    }
    return pathMatched ? 'method' : null;
  }
}

function paramCount(r: Route) {
  return r.segments.filter((s) => s.startsWith(':')).length;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string | null | undefined): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
/** Path IDs that are not UUIDs can never exist: answer 404 like any unknown ID. */
export function uuidParam(ctx: Ctx, name: string): string {
  const v = ctx.params[name];
  if (!isUuid(v)) throw new AppError('NOT_FOUND');
  return v.toLowerCase();
}

function formatZodError(err: z.ZodError): AppError {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return invalid('請求內容無效。', fieldErrors);
}

export function jsonResponse(status: number, body: unknown, requestId: string, extraHeaders: Record<string, string> = {}, cookies: string[] = []) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-request-id': requestId,
    ...extraHeaders,
  });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

export function errorBody(err: AppError, requestId: string) {
  return {
    error: {
      code: err.code,
      message: err.message,
      fieldErrors: err.fieldErrors,
      retryable: err.retryable,
      requestId,
      ...(err.details ? { details: err.details } : {}),
    },
  };
}

interface PgLikeError { code?: string; constraint_name?: string; constraint?: string }

function mapDbError(e: unknown): AppError | null {
  const pe = e as PgLikeError;
  if (!pe || typeof pe.code !== 'string') return null;
  const constraint = pe.constraint_name ?? pe.constraint ?? '';
  if (pe.code === '23514' && constraint === 'feedback_tags_single_select') {
    return new AppError('SINGLE_SELECT_CONFLICT', '單選群組只能選一個標籤。');
  }
  if (pe.code === '40001' || pe.code === '40P01') {
    return new AppError('REVISION_CONFLICT', '同時有其他操作，請重新載入後再試。', { retryable: true });
  }
  if (pe.code === '23505') return new AppError('REVISION_CONFLICT', '資料已存在或已被同時修改，請重新載入。');
  if (pe.code === '23503') return new AppError('NOT_FOUND');
  if (pe.code === '23514') return new AppError('INVALID_REQUEST', '資料不符合限制。');
  if (pe.code === '22P02') return new AppError('NOT_FOUND');
  return null;
}

export interface HandleOptions {
  /** Allow tests to skip the Origin check (they always send it anyway). */
  router: Router;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function handleApi(req: Request, router: Router): Promise<Response> {
  const requestId = req.headers.get('x-request-id')?.slice(0, 64) || randomUUID();
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  const site = siteForHost(host);
  const started = Date.now();
  const cookies: string[] = [];
  let status = 500;
  try {
    if (!site) throw new AppError('NOT_FOUND', '未知的網站來源。');
    const path = url.pathname.replace(/^\/api\/v1/, '') || '/';
    const method = req.method.toUpperCase();
    // CSRF: cookie-authenticated writes must come from the same site origin.
    if (!SAFE_METHODS.has(method)) {
      const reqOrigin = req.headers.get('origin');
      const isJobRunner = path === '/jobs/run';
      if (!isJobRunner && reqOrigin !== originForSite(site)) {
        throw new AppError('ACTION_FORBIDDEN', '來源不被允許。');
      }
    }
    const m = router.match(method, path);
    if (m === null) throw new AppError('NOT_FOUND');
    if (m === 'method') throw new AppError('INVALID_REQUEST', '不支援的方法。');
    if (!m.route.sites.includes(site)) throw new AppError('NOT_FOUND');

    const session = await loadSession(req, site);
    let bodyCache: unknown;
    let bodyLoaded = false;
    const ctx: Ctx = {
      req, url, method, site, requestId,
      params: m.params,
      user: session?.user ?? null,
      sessionHash: session?.idHash ?? null,
      routePattern: m.route.pattern,
      cookies,
      async rawBody() {
        if (!bodyLoaded) {
          bodyLoaded = true;
          const text = await req.text();
          if (!text) bodyCache = {};
          else {
            const ct = req.headers.get('content-type') ?? '';
            if (!ct.includes('application/json')) throw invalid('需要 application/json 內容。');
            try { bodyCache = JSON.parse(text); } catch { throw invalid('JSON 格式錯誤。'); }
          }
        }
        return bodyCache;
      },
      async body(schema) {
        const parsed = schema.safeParse(await this.rawBody());
        if (!parsed.success) throw formatZodError(parsed.error);
        return parsed.data;
      },
      query(schema) {
        const obj: Record<string, string | string[]> = {};
        for (const [k, v] of url.searchParams) {
          if (k in obj) obj[k] = ([] as string[]).concat(obj[k], v);
          else obj[k] = v;
        }
        const parsed = schema.safeParse(obj);
        if (!parsed.success) throw formatZodError(parsed.error);
        return parsed.data;
      },
      header(name) { return req.headers.get(name); },
      idempotencyKey(required) {
        const key = req.headers.get('idempotency-key');
        if (!key) {
          if (required) throw invalid('缺少 Idempotency-Key。');
          return null;
        }
        if (key.length < 8 || key.length > 200) throw invalid('Idempotency-Key 長度無效。');
        return key;
      },
      ifMatchRevision() {
        const raw = req.headers.get('if-match');
        if (!raw) throw new AppError('REVISION_REQUIRED');
        const n = Number(raw.replace(/^W\//, '').replace(/"/g, ''));
        if (!Number.isInteger(n) || n < 0) throw invalid('If-Match 格式錯誤。');
        return n;
      },
    };
    const jobs: string[] = [];
    const result = await jobCollector.run(jobs, () => m.route.handler(ctx));
    if (jobs.length) {
      // committed work is processed right away; the scheduled runner retries anything left
      await processJobs({ ids: jobs }).catch((e) => logError('jobs.inline', e, { requestId }));
    }
    if (result instanceof Response) {
      status = result.status;
      for (const c of cookies) result.headers.append('set-cookie', c);
      return result;
    }
    status = result.status ?? 200;
    return jsonResponse(status, { data: result.data, meta: { requestId, ...(result.meta ?? {}) } }, requestId, {}, cookies);
  } catch (e) {
    let err: AppError;
    if (e instanceof AppError) err = e;
    else {
      err = mapDbError(e) ?? new AppError('INTERNAL');
      if (err.code === 'INTERNAL') logError('api.unhandled', e, { requestId, path: url.pathname });
    }
    status = err.status;
    return jsonResponse(err.status, errorBody(err, requestId), requestId, err.headers ?? {}, cookies);
  } finally {
    if (getConfig().isProductionDeployment || process.env.LOG_REQUESTS === '1') {
      logInfo('api.request', { requestId, method: req.method, path: url.pathname, status, ms: Date.now() - started });
    }
  }
}
