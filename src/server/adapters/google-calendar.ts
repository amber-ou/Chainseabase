import { DateTime } from 'luxon';
import { getConfig } from '../config';
import { expandOccurrences, instanceId, parseRecurrence } from '@/modules/calendar/recurrence';

export interface GEventTime { dateTime?: string; date?: string; timeZone?: string }
export interface GEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  etag: string;
  summary?: string;
  description?: string;
  location?: string;
  start: GEventTime;
  end: GEventTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GEventTime;
  attendees?: unknown[];
  conferenceData?: unknown;
  eventType?: string;
  htmlLink?: string;
  updated?: string;
  reminders?: unknown;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}

export interface GCalendar { id: string; summary: string; accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader'; timeZone: string; primary?: boolean }

export type CalendarErrorKind =
  | 'unauthorized' | 'forbidden' | 'not_found' | 'gone' | 'precondition' | 'duplicate' | 'rate_limited' | 'server' | 'timeout' | 'bad_request';

export class CalendarApiError extends Error {
  constructor(public readonly kind: CalendarErrorKind, public readonly status: number, public readonly retryAfter?: number) {
    super(`calendar_${kind}_${status}`);
  }
}

export interface CalendarApi {
  readonly mode: 'real' | 'fake';
  listCalendars(token: string): Promise<GCalendar[]>;
  getCalendar(token: string, calendarId: string): Promise<GCalendar | null>;
  listEvents(token: string, calendarId: string, window: { timeMin: string; timeMax: string }): Promise<GEvent[]>;
  getEvent(token: string, calendarId: string, eventId: string): Promise<GEvent>;
  insertEvent(token: string, calendarId: string, event: Partial<GEvent> & { id: string }): Promise<GEvent>;
  patchEvent(token: string, calendarId: string, eventId: string, patch: Partial<GEvent>, etag: string): Promise<GEvent>;
  deleteEvent(token: string, calendarId: string, eventId: string, etag: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Real Google Calendar REST adapter
// ---------------------------------------------------------------------------

const BASE = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export class RealCalendarApi implements CalendarApi {
  readonly mode = 'real' as const;
  constructor(private fetchImpl: typeof fetch = fetch) {}

  private async call<T>(token: string, method: string, path: string, opts: { body?: unknown; etag?: string; retry?: boolean } = {}): Promise<T> {
    const attempts = opts.retry ? 3 : 1;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${BASE}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(opts.body ? { 'content-type': 'application/json' } : {}),
            ...(opts.etag ? { 'if-match': opts.etag } : {}),
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        if (attempt < attempts) { await sleep(backoff(attempt)); continue; }
        throw new CalendarApiError('timeout', 0);
      }
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
      const kind = await classify(res);
      const retryAfter = Number(res.headers.get('retry-after') ?? '') || undefined;
      if ((kind === 'rate_limited' || kind === 'server') && attempt < attempts) { await sleep(retryAfter ? retryAfter * 1000 : backoff(attempt)); continue; }
      throw new CalendarApiError(kind, res.status, retryAfter);
    }
  }

  async listCalendars(token: string): Promise<GCalendar[]> {
    const out: GCalendar[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) });
      const r = await this.call<{ items?: GCalendar[]; nextPageToken?: string }>(token, 'GET', `/users/me/calendarList?${q}`, { retry: true });
      out.push(...(r.items ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async getCalendar(token: string, calendarId: string): Promise<GCalendar | null> {
    try {
      return await this.call<GCalendar>(token, 'GET', `/users/me/calendarList/${enc(calendarId)}`, { retry: true });
    } catch (e) {
      if (e instanceof CalendarApiError && (e.kind === 'not_found' || e.kind === 'forbidden')) return null;
      throw e;
    }
  }

  async listEvents(token: string, calendarId: string, w: { timeMin: string; timeMax: string }): Promise<GEvent[]> {
    const out: GEvent[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin: w.timeMin, timeMax: w.timeMax, maxResults: '250', ...(pageToken ? { pageToken } : {}) });
      const r = await this.call<{ items?: GEvent[]; nextPageToken?: string }>(token, 'GET', `/calendars/${enc(calendarId)}/events?${q}`, { retry: true });
      out.push(...(r.items ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  getEvent(token: string, calendarId: string, eventId: string) {
    return this.call<GEvent>(token, 'GET', `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, { retry: true });
  }

  insertEvent(token: string, calendarId: string, event: Partial<GEvent> & { id: string }) {
    // the client-generated id makes a retry of the same request idempotent (409 on duplicate)
    return this.call<GEvent>(token, 'POST', `/calendars/${enc(calendarId)}/events?sendUpdates=none`, { body: event });
  }

  patchEvent(token: string, calendarId: string, eventId: string, patch: Partial<GEvent>, etag: string) {
    return this.call<GEvent>(token, 'PATCH', `/calendars/${enc(calendarId)}/events/${enc(eventId)}?sendUpdates=none`, { body: patch, etag });
  }

  async deleteEvent(token: string, calendarId: string, eventId: string, etag: string) {
    await this.call<void>(token, 'DELETE', `/calendars/${enc(calendarId)}/events/${enc(eventId)}?sendUpdates=none`, { etag });
  }
}

function backoff(attempt: number) {
  return Math.min(8000, 500 * 2 ** (attempt - 1)) * (0.5 + Math.random());
}

async function classify(res: Response): Promise<CalendarErrorKind> {
  const body = (await res.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[] } };
  const reason = body.error?.errors?.[0]?.reason ?? '';
  switch (res.status) {
    case 400: return 'bad_request';
    case 401: return 'unauthorized';
    case 403: return ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(reason) ? 'rate_limited' : 'forbidden';
    case 404: return 'not_found';
    case 409: return 'duplicate';
    case 410: return 'gone';
    case 412: return 'precondition';
    case 429: return 'rate_limited';
    default: return res.status >= 500 ? 'server' : 'bad_request';
  }
}

// ---------------------------------------------------------------------------
// In-memory fake (tests / clearly labelled local demo). Never used in production.
// ---------------------------------------------------------------------------

interface FakeCalendar { id: string; summary: string; timeZone: string; acl: Map<string, GCalendar['accessRole']>; events: Map<string, GEvent>; overrides: Map<string, GEvent> }
type Op = 'list' | 'get' | 'insert' | 'patch' | 'delete';

export class FakeCalendarApi implements CalendarApi {
  readonly mode = 'fake' as const;
  calendars = new Map<string, FakeCalendar>();
  private etagCounter = 1;
  private failures: { op: Op; kind: CalendarErrorKind; afterApply?: boolean; status?: number }[] = [];
  calls: { op: Op; eventId?: string }[] = [];
  pageSize = 250;

  /** Token format issued by FakeGoogleOAuthClient: fake-access-<sub>-<random> */
  private userOf(token: string): string {
    const m = /^fake-access-(.+)-[a-z0-9]+$/.exec(token);
    if (!m) throw new CalendarApiError('unauthorized', 401);
    return m[1];
  }
  private nextEtag() { return `"${this.etagCounter++}"`; }

  addCalendar(id: string, summary: string, timeZone: string, acl: Record<string, GCalendar['accessRole']>) {
    this.calendars.set(id, { id, summary, timeZone, acl: new Map(Object.entries(acl)), events: new Map(), overrides: new Map() });
  }
  injectFailure(op: Op, kind: CalendarErrorKind, opts: { afterApply?: boolean } = {}) {
    this.failures.push({ op, kind, afterApply: opts.afterApply });
  }
  /** Simulate an edit made directly in Google (bumps the ETag). */
  externalEdit(calendarId: string, eventId: string, patch: Partial<GEvent>) {
    const cal = this.calendars.get(calendarId)!;
    const ev = cal.events.get(eventId);
    if (ev) cal.events.set(eventId, { ...ev, ...patch, etag: this.nextEtag(), updated: new Date().toISOString() });
    else {
      const inst = this.computeInstance(cal, eventId)!;
      cal.overrides.set(eventId, { ...inst, ...patch, etag: this.nextEtag() });
    }
  }

  private takeFailure(op: Op, phase: 'before' | 'after') {
    const i = this.failures.findIndex((f) => f.op === op && Boolean(f.afterApply) === (phase === 'after'));
    if (i < 0) return;
    const f = this.failures.splice(i, 1)[0];
    throw new CalendarApiError(f.kind, f.kind === 'timeout' ? 0 : statusFor(f.kind));
  }

  private access(token: string, calendarId: string, need: 'read' | 'write'): FakeCalendar {
    const user = this.userOf(token);
    const cal = this.calendars.get(calendarId);
    const role = cal?.acl.get(user);
    if (!cal || !role) throw new CalendarApiError('not_found', 404);
    if (need === 'write' && !(role === 'owner' || role === 'writer')) throw new CalendarApiError('forbidden', 403);
    return cal;
  }

  async listCalendars(token: string): Promise<GCalendar[]> {
    const user = this.userOf(token);
    return [...this.calendars.values()].filter((c) => c.acl.has(user))
      .map((c) => ({ id: c.id, summary: c.summary, timeZone: c.timeZone, accessRole: c.acl.get(user)! }));
  }

  async getCalendar(token: string, calendarId: string) {
    const user = this.userOf(token);
    const c = this.calendars.get(calendarId);
    const role = c?.acl.get(user);
    return c && role ? { id: c.id, summary: c.summary, timeZone: c.timeZone, accessRole: role } : null;
  }

  private computeInstance(cal: FakeCalendar, id: string): GEvent | null {
    const sep = id.lastIndexOf('_');
    if (sep < 0) return null;
    const master = cal.events.get(id.slice(0, sep));
    if (!master || !master.recurrence) return null;
    const all = this.expand(cal, master, DateTime.fromISO('1970-01-01'), DateTime.fromISO('2100-01-01'));
    return all.find((e) => e.id === id) ?? null;
  }

  private expand(cal: FakeCalendar, master: GEvent, from: DateTime, to: DateTime): GEvent[] {
    const parsed = parseRecurrence(master.recurrence, master.start.timeZone ?? cal.timeZone);
    if (parsed.kind !== 'basic') return [];
    const allDay = Boolean(master.start.date);
    const zone = master.start.timeZone ?? cal.timeZone;
    const start = allDay ? DateTime.fromISO(master.start.date!, { zone }) : DateTime.fromISO(master.start.dateTime!, { setZone: true }).setZone(zone);
    const end = allDay ? DateTime.fromISO(master.end.date!, { zone }) : DateTime.fromISO(master.end.dateTime!, { setZone: true }).setZone(zone);
    const duration = end.diff(start);
    return expandOccurrences(start, parsed.rule, { windowStart: from, windowEnd: to, allDay }).map((occ) => {
      const id = instanceId(master.id, occ, allDay);
      const time = (d: DateTime): GEventTime => (allDay ? { date: d.toISODate()! } : { dateTime: d.toISO({ suppressMilliseconds: true })!, timeZone: zone });
      const base: GEvent = {
        ...master, id, recurrence: undefined, recurringEventId: master.id, originalStartTime: time(occ),
        start: time(occ), end: time(occ.plus(duration)), etag: `${master.etag.slice(0, -1)}-${id}"`,
      };
      const ov = cal.overrides.get(id);
      return ov ? { ...base, ...ov, id, recurringEventId: master.id, originalStartTime: time(occ) } : base;
    });
  }

  async listEvents(token: string, calendarId: string, w: { timeMin: string; timeMax: string }): Promise<GEvent[]> {
    this.calls.push({ op: 'list' });
    this.takeFailure('list', 'before');
    const cal = this.access(token, calendarId, 'read');
    const from = DateTime.fromISO(w.timeMin);
    const to = DateTime.fromISO(w.timeMax);
    const out: GEvent[] = [];
    for (const ev of cal.events.values()) {
      if (ev.status === 'cancelled') continue;
      if (ev.recurrence) out.push(...this.expand(cal, ev, from, to).filter((e) => e.status !== 'cancelled'));
      else {
        const s = DateTime.fromISO(ev.start.dateTime ?? ev.start.date!);
        const e = DateTime.fromISO(ev.end.dateTime ?? ev.end.date!);
        if (s < to && e > from) out.push(ev);
      }
    }
    return out.sort((a, b) => (a.start.dateTime ?? a.start.date!).localeCompare(b.start.dateTime ?? b.start.date!));
  }

  async getEvent(token: string, calendarId: string, eventId: string): Promise<GEvent> {
    this.calls.push({ op: 'get', eventId });
    this.takeFailure('get', 'before');
    const cal = this.access(token, calendarId, 'read');
    const ev = cal.events.get(eventId) ?? this.computeInstance(cal, eventId);
    if (!ev) throw new CalendarApiError('not_found', 404);
    if (ev.status === 'cancelled') throw new CalendarApiError('gone', 410);
    return structuredClone(ev);
  }

  async insertEvent(token: string, calendarId: string, event: Partial<GEvent> & { id: string }): Promise<GEvent> {
    this.calls.push({ op: 'insert', eventId: event.id });
    this.takeFailure('insert', 'before');
    const cal = this.access(token, calendarId, 'write');
    if (!/^[a-v0-9]{5,1024}$/.test(event.id)) throw new CalendarApiError('bad_request', 400);
    if (cal.events.has(event.id)) throw new CalendarApiError('duplicate', 409);
    const stored: GEvent = {
      reminders: { useDefault: true }, ...event, status: 'confirmed', etag: this.nextEtag(), updated: new Date().toISOString(),
      htmlLink: `https://calendar.google.com/calendar/event?eid=${event.id}`,
    } as GEvent;
    cal.events.set(event.id, stored);
    this.takeFailure('insert', 'after');
    return structuredClone(stored);
  }

  async patchEvent(token: string, calendarId: string, eventId: string, patch: Partial<GEvent>, etag: string): Promise<GEvent> {
    this.calls.push({ op: 'patch', eventId });
    this.takeFailure('patch', 'before');
    const cal = this.access(token, calendarId, 'write');
    const master = cal.events.get(eventId);
    const current = master ?? this.computeInstance(cal, eventId);
    if (!current) throw new CalendarApiError('not_found', 404);
    if (current.etag !== etag) throw new CalendarApiError('precondition', 412);
    const merged: GEvent = {
      ...current, ...patch,
      extendedProperties: { ...current.extendedProperties, private: { ...current.extendedProperties?.private, ...patch.extendedProperties?.private } },
      etag: this.nextEtag(), updated: new Date().toISOString(),
    };
    if (master) cal.events.set(eventId, merged);
    else cal.overrides.set(eventId, merged);
    this.takeFailure('patch', 'after');
    return structuredClone(merged);
  }

  async deleteEvent(token: string, calendarId: string, eventId: string, etag: string): Promise<void> {
    this.calls.push({ op: 'delete', eventId });
    this.takeFailure('delete', 'before');
    const cal = this.access(token, calendarId, 'write');
    const master = cal.events.get(eventId);
    const current = master ?? this.computeInstance(cal, eventId);
    if (!current || current.status === 'cancelled') throw new CalendarApiError('gone', 410);
    if (current.etag !== etag) throw new CalendarApiError('precondition', 412);
    if (master) cal.events.set(eventId, { ...master, status: 'cancelled', etag: this.nextEtag() });
    else cal.overrides.set(eventId, { ...current, status: 'cancelled', etag: this.nextEtag() });
    this.takeFailure('delete', 'after');
  }
}

function statusFor(kind: CalendarErrorKind): number {
  return { unauthorized: 401, forbidden: 403, not_found: 404, gone: 410, precondition: 412, duplicate: 409, rate_limited: 429, server: 503, timeout: 0, bad_request: 400 }[kind];
}

const g = globalThis as unknown as { __csbCalendar?: CalendarApi };

export function getCalendarApi(): CalendarApi {
  if (!g.__csbCalendar) g.__csbCalendar = getConfig().calendarProvider === 'real' ? new RealCalendarApi() : new FakeCalendarApi();
  return g.__csbCalendar;
}

export function setCalendarApi(api: CalendarApi | undefined) {
  g.__csbCalendar = api;
}
