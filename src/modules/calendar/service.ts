import { DateTime } from 'luxon';
import type { Db } from '@/server/db';
import { getSql } from '@/server/db';
import { AppError, assertRevision, invalid } from '@/server/errors';
import { bodyHash, sha256Hex } from '@/server/crypto';
import { CalendarApiError, getCalendarApi, type GCalendar, type GEvent } from '@/server/adapters/google-calendar';
import { dropAccessToken, getAccessToken } from './credentials';
import { allDayFromGoogle, allDayToGoogle, buildRRule, isDate, isValidTimeZone, parseRecurrence, type RecurrenceInput } from './recurrence';

export interface BindingRow { productId: string; calendarId: string; calendarSummary: string; calendarTimezone: string; boundBy: string; revision: number }

export async function getBinding(db: Db, productId: string): Promise<BindingRow | null> {
  const [b] = await db<BindingRow[]>`select * from calendar_bindings where product_id = ${productId}`;
  return b ?? null;
}

function mapApiError(e: unknown, userId: string): never {
  if (e instanceof AppError) throw e;
  if (e instanceof CalendarApiError) {
    switch (e.kind) {
      case 'unauthorized':
        dropAccessToken(userId);
        throw new AppError('CALENDAR_REAUTH_REQUIRED', 'Google 日曆授權已失效，請重新連結。');
      case 'forbidden': throw new AppError('CALENDAR_READ_ONLY', '你在 Google 對此日曆沒有編輯權限。');
      case 'not_found': throw new AppError('NOT_FOUND', '找不到日曆或活動，或你在 Google 沒有權限。');
      case 'gone': throw new AppError('NOT_FOUND', '活動已被刪除。');
      case 'precondition': throw new AppError('EVENT_CONFLICT');
      case 'duplicate': throw new AppError('EVENT_CONFLICT', '活動識別碼已存在。');
      case 'rate_limited': throw new AppError('RATE_LIMITED', 'Google 日曆請求過多，請稍後再試。', { headers: e.retryAfter ? { 'retry-after': String(e.retryAfter) } : {} });
      case 'bad_request': throw new AppError('INVALID_REQUEST', 'Google 拒絕了活動內容。');
      default: throw new AppError('UPSTREAM_UNAVAILABLE', 'Google 日曆暫時無法使用，請稍後再試。', { retryable: true });
    }
  }
  throw e;
}

async function token(userId: string) {
  return getAccessToken(getSql(), userId);
}

// ---------------------------------------------------------------------------
// Calendars and binding
// ---------------------------------------------------------------------------

export async function listUserCalendars(userId: string) {
  const t = await token(userId);
  try {
    const cals = await getCalendarApi().listCalendars(t);
    return cals.map((c) => ({ id: c.id, summary: c.summary, accessRole: c.accessRole, timeZone: c.timeZone, bindable: c.accessRole === 'owner' || c.accessRole === 'writer' }));
  } catch (e) {
    mapApiError(e, userId);
  }
}

export async function calendarAccess(userId: string, calendarId: string): Promise<GCalendar['accessRole'] | 'none'> {
  const t = await token(userId);
  try {
    const c = await getCalendarApi().getCalendar(t, calendarId);
    return c?.accessRole ?? 'none';
  } catch (e) {
    mapApiError(e, userId);
  }
}

export async function bindCalendar(db: Db, userId: string, productId: string, calendarId: string, expectedRevision: number) {
  const t = await token(userId);
  let cal: GCalendar | null;
  try {
    cal = await getCalendarApi().getCalendar(t, calendarId);
  } catch (e) {
    mapApiError(e, userId);
  }
  if (!cal) throw new AppError('CALENDAR_ACCESS_DENIED', '你在 Google 無法存取此日曆。');
  if (cal.accessRole !== 'owner' && cal.accessRole !== 'writer') throw new AppError('CALENDAR_READ_ONLY', '綁定需要此日曆的編輯權限。');
  return getSql().begin(async (tx) => {
    const [b] = await tx<BindingRow[]>`select * from calendar_bindings where product_id = ${productId} for update`;
    assertRevision(b?.revision ?? 0, expectedRevision);
    const [other] = await tx`select product_id from calendar_bindings where calendar_id = ${calendarId} and product_id <> ${productId}`;
    if (other) throw new AppError('REFERENCE_IN_USE', '此日曆已綁定其他產品。');
    const [row] = b
      ? await tx<BindingRow[]>`
          update calendar_bindings set calendar_id = ${calendarId}, calendar_summary = ${cal!.summary}, calendar_timezone = ${cal!.timeZone},
            bound_by = ${userId}, revision = revision + 1 where product_id = ${productId} returning *
        `
      : await tx<BindingRow[]>`
          insert into calendar_bindings (product_id, calendar_id, calendar_summary, calendar_timezone, bound_by)
          values (${productId}, ${calendarId}, ${cal!.summary}, ${cal!.timeZone}, ${userId}) returning *
        `;
    if (b && b.calendarId !== calendarId) await tx`delete from calendar_event_links where product_id = ${productId} and calendar_id = ${b.calendarId}`;
    void db;
    return row;
  });
}

export async function unbindCalendar(tx: Db, productId: string, expectedRevision: number) {
  const [b] = await tx<BindingRow[]>`select * from calendar_bindings where product_id = ${productId} for update`;
  if (!b) throw new AppError('NOT_FOUND');
  assertRevision(b.revision, expectedRevision);
  // events in Google are untouched; only the platform relation goes away
  await tx`delete from calendar_event_links where product_id = ${productId} and calendar_id = ${b.calendarId}`;
  await tx`delete from calendar_bindings where product_id = ${productId}`;
}

async function requireBinding(productId: string, bindingRevision?: number): Promise<BindingRow> {
  const b = await getBinding(getSql(), productId);
  if (!b) throw new AppError('CALENDAR_NOT_BOUND', '此產品尚未綁定 Google 日曆。');
  if (bindingRevision !== undefined && b.revision !== bindingRevision) {
    throw new AppError('REVISION_CONFLICT', '產品日曆綁定已變更，請重新載入後再操作。');
  }
  return b;
}

// ---------------------------------------------------------------------------
// Event projection
// ---------------------------------------------------------------------------

export type ReadOnlyReason = null | 'calendar_read_only' | 'special_event_type' | 'has_attendees_or_meeting';

export function readOnlyReason(ev: GEvent, accessRole: string): ReadOnlyReason {
  if (accessRole !== 'owner' && accessRole !== 'writer') return 'calendar_read_only';
  if (ev.eventType && ev.eventType !== 'default') return 'special_event_type';
  if ((ev.attendees && ev.attendees.length > 0) || ev.conferenceData) return 'has_attendees_or_meeting';
  return null;
}

export function eventDto(ev: GEvent, accessRole: string, link: { feedbackId: string; title: string } | null, defaultTz: string) {
  const allDay = Boolean(ev.start.date);
  const recurrence = parseRecurrence(ev.recurrence, ev.start.timeZone ?? defaultTz);
  const days = allDay ? allDayFromGoogle(ev.start.date!, ev.end.date!) : null;
  return {
    id: ev.id,
    seriesId: ev.recurringEventId ?? (ev.recurrence ? ev.id : null),
    isInstance: Boolean(ev.recurringEventId),
    isRecurring: Boolean(ev.recurringEventId || ev.recurrence),
    originalStartTime: ev.originalStartTime?.dateTime ?? ev.originalStartTime?.date ?? null,
    summary: ev.summary ?? '（無標題）',
    description: ev.description ?? '',
    location: ev.location ?? '',
    allDay,
    startDateTime: ev.start.dateTime ?? null,
    endDateTime: ev.end.dateTime ?? null,
    startDate: days?.startDate ?? null,
    endDateInclusive: days?.endDateInclusive ?? null,
    timeZone: ev.start.timeZone ?? defaultTz,
    recurrence: recurrence.kind === 'basic' ? recurrence.rule : null,
    recurrenceComplex: recurrence.kind === 'complex',
    etag: ev.etag,
    updated: ev.updated ?? null,
    htmlLink: ev.htmlLink ?? null,
    readOnlyReason: readOnlyReason(ev, accessRole),
    feedbackLink: link,
  };
}

async function linksFor(db: Db, productId: string, calendarId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, { feedbackId: string; title: string }>();
  const rows = await db<{ eventId: string; feedbackId: string; title: string }[]>`
    select l.event_id, l.feedback_id, f.title from calendar_event_links l join feedback f on f.id = l.feedback_id
    where l.product_id = ${productId} and l.calendar_id = ${calendarId} and l.event_id in ${db(ids)} and f.deleted_at is null
  `;
  return new Map(rows.map((r) => [r.eventId, { feedbackId: r.feedbackId, title: r.title }]));
}

export async function listEvents(userId: string, productId: string, window: { from: string; to: string }) {
  const b = await requireBinding(productId);
  const from = DateTime.fromISO(window.from, { setZone: true });
  const to = DateTime.fromISO(window.to, { setZone: true });
  if (!from.isValid || !to.isValid || to <= from || to.diff(from, 'days').days > 62) throw invalid('時間區間無效（最多 62 天）。');
  const t = await token(userId);
  const access = await calendarAccess(userId, b.calendarId);
  if (access === 'none' || access === 'freeBusyReader') throw new AppError('CALENDAR_ACCESS_DENIED', '你在 Google 沒有此產品日曆的檢視權限，請向公司管理員申請分享。');
  let events: GEvent[];
  try {
    events = await getCalendarApi().listEvents(t, b.calendarId, { timeMin: from.toISO()!, timeMax: to.toISO()! });
  } catch (e) {
    mapApiError(e, userId);
  }
  const links = await linksFor(getSql(), productId, b.calendarId, [...new Set(events.flatMap((e) => [e.id, e.recurringEventId].filter(Boolean) as string[]))]);
  return {
    binding: { calendarId: b.calendarId, summary: b.calendarSummary, timeZone: b.calendarTimezone, revision: b.revision },
    accessRole: access,
    fetchedAt: new Date().toISOString(),
    events: events.filter((e) => e.status !== 'cancelled').map((e) => eventDto(e, access, links.get(e.id) ?? (e.recurringEventId ? links.get(e.recurringEventId) ?? null : null), b.calendarTimezone)),
  };
}

export async function getEvent(userId: string, productId: string, eventId: string) {
  const b = await requireBinding(productId);
  const t = await token(userId);
  const access = await calendarAccess(userId, b.calendarId);
  if (access === 'none' || access === 'freeBusyReader') throw new AppError('CALENDAR_ACCESS_DENIED');
  let ev: GEvent;
  try {
    ev = await getCalendarApi().getEvent(t, b.calendarId, eventId);
  } catch (e) {
    mapApiError(e, userId);
  }
  const links = await linksFor(getSql(), productId, b.calendarId, [ev.id, ...(ev.recurringEventId ? [ev.recurringEventId] : [])]);
  return { event: eventDto(ev, access, links.get(ev.id) ?? (ev.recurringEventId ? links.get(ev.recurringEventId) ?? null : null), b.calendarTimezone), bindingRevision: b.revision };
}

// ---------------------------------------------------------------------------
// Writes: mutation records make retries safe across the non-transactional boundary
// ---------------------------------------------------------------------------

export interface EventFields {
  summary?: string;
  description?: string;
  location?: string;
  allDay?: boolean;
  startDateTime?: string;
  endDateTime?: string;
  startDate?: string;
  endDateInclusive?: string;
  timeZone?: string;
  recurrence?: RecurrenceInput | null;
}

function validateTimes(f: EventFields, requireAll: boolean): Partial<GEvent> {
  const out: Partial<GEvent> = {};
  if (f.allDay === undefined && !requireAll && f.startDateTime === undefined && f.startDate === undefined) return out;
  const tz = f.timeZone ?? 'Asia/Taipei';
  if (!isValidTimeZone(tz)) throw invalid('時區無效。', { timeZone: '請使用 IANA 時區，例如 Asia/Taipei' });
  if (f.allDay) {
    if (!f.startDate || !f.endDateInclusive || !isDate(f.startDate) || !isDate(f.endDateInclusive)) throw invalid('請輸入開始與結束日期。', { startDate: '日期格式 YYYY-MM-DD' });
    if (f.endDateInclusive < f.startDate) throw invalid('結束日期不可早於開始日期。', { endDateInclusive: '結束日期不可早於開始日期' });
    const r = allDayToGoogle(f.startDate, f.endDateInclusive);
    out.start = r.start;
    out.end = r.end;
  } else {
    const s = DateTime.fromISO(f.startDateTime ?? '', { setZone: true });
    const e = DateTime.fromISO(f.endDateTime ?? '', { setZone: true });
    if (!s.isValid || !e.isValid || !/[+-]\d{2}:\d{2}$|Z$/.test(f.startDateTime ?? '') || !/[+-]\d{2}:\d{2}$|Z$/.test(f.endDateTime ?? '')) {
      throw invalid('請輸入含時區位移的開始與結束時間。', { startDateTime: 'RFC3339 時間' });
    }
    if (e <= s) throw invalid('結束時間必須晚於開始時間。', { endDateTime: '結束時間必須晚於開始時間' });
    out.start = { dateTime: s.toISO({ suppressMilliseconds: true })!, timeZone: tz };
    out.end = { dateTime: e.toISO({ suppressMilliseconds: true })!, timeZone: tz };
  }
  return out;
}

function recurrenceLines(r: RecurrenceInput | null | undefined, allDay: boolean, tz: string): string[] | undefined {
  if (r === undefined) return undefined;
  if (r === null) return [];
  if (r.end.type === 'until' && !isDate(r.end.until)) throw invalid('重複結束日期無效。', { recurrence: '結束日期格式 YYYY-MM-DD' });
  return [buildRRule(r, { allDay, timeZone: tz })];
}

interface MutationRow { id: string; state: string; bodyHash: string; result: Record<string, unknown> | null; googleEventId: string | null; operation: string; calendarId: string }

async function beginMutation(userId: string, productId: string, key: string, operation: 'create' | 'update' | 'delete', calendarId: string, body: unknown, eventId: string | null) {
  const hash = bodyHash({ operation, productId, body, eventId });
  const sql = getSql();
  const inserted = await sql<MutationRow[]>`
    insert into calendar_mutations (user_id, product_id, request_key, operation, calendar_id, google_event_id, body_hash, state)
    values (${userId}, ${productId}, ${key}, ${operation}, ${calendarId}, ${eventId}, ${hash}, 'pending')
    on conflict (user_id, request_key) do nothing returning *
  `;
  if (inserted[0]) return { mutation: inserted[0], replay: false };
  const [existing] = await sql<MutationRow[]>`select * from calendar_mutations where user_id = ${userId} and request_key = ${key}`;
  if (existing.bodyHash !== hash) throw new AppError('IDEMPOTENCY_CONFLICT');
  return { mutation: existing, replay: true };
}

async function finishMutation(id: string, state: 'succeeded' | 'failed' | 'unknown', patch: { googleEventId?: string; result?: unknown; errorCode?: string } = {}) {
  await getSql()`
    update calendar_mutations set state = ${state}, google_event_id = coalesce(${patch.googleEventId ?? null}, google_event_id),
      result = coalesce(${patch.result ? getSql().json(patch.result as never) : null}, result), error_code = ${patch.errorCode ?? null}, updated_at = now()
    where id = ${id}
  `;
}

export function deterministicEventId(mutationId: string): string {
  // Google event ids allow base32hex characters (a-v, 0-9); hex is a subset
  return `csb${sha256Hex(`calendar-mutation:${mutationId}`).slice(0, 40)}`;
}

async function ensureLink(productId: string, calendarId: string, eventId: string, feedbackId: string, userId: string) {
  await getSql()`
    insert into calendar_event_links (product_id, calendar_id, event_id, feedback_id, created_by)
    values (${productId}, ${calendarId}, ${eventId}, ${feedbackId}, ${userId})
    on conflict (calendar_id, event_id) do nothing
  `;
}

async function assertFeedbackInProduct(productId: string, feedbackId: string) {
  const [f] = await getSql()`select 1 from feedback where id = ${feedbackId} and product_id = ${productId} and deleted_at is null`;
  if (!f) throw invalid('只能關聯同產品的 Feedback。', { feedbackId: '找不到此產品的 Feedback' });
}

export type MutationOutcome =
  | { state: 'succeeded'; event: ReturnType<typeof eventDto> | null; mutationId: string }
  | { state: 'unknown'; mutationId: string };

export async function createEvent(
  userId: string, productId: string, key: string,
  input: EventFields & { summary: string; feedbackId?: string | null; bindingRevision: number },
): Promise<MutationOutcome> {
  const b = await requireBinding(productId, input.bindingRevision);
  if (input.feedbackId) await assertFeedbackInProduct(productId, input.feedbackId);
  const times = validateTimes(input, true);
  const tz = input.timeZone ?? 'Asia/Taipei';
  const recurrence = recurrenceLines(input.recurrence, Boolean(input.allDay), tz);
  const { mutation, replay } = await beginMutation(userId, productId, key, 'create', b.calendarId, input, null);
  const eventId = deterministicEventId(mutation.id);
  const t = await token(userId);
  const api = getCalendarApi();
  const access = await calendarAccess(userId, b.calendarId);
  const succeed = async (ev: GEvent) => {
    await finishMutation(mutation.id, 'succeeded', { googleEventId: ev.id, result: { eventId: ev.id } });
    if (input.feedbackId) await ensureLink(productId, b.calendarId, ev.id, input.feedbackId, userId);
    const links = input.feedbackId ? await linksFor(getSql(), productId, b.calendarId, [ev.id]) : new Map();
    return { state: 'succeeded' as const, mutationId: mutation.id, event: eventDto(ev, access, links.get(ev.id) ?? null, b.calendarTimezone) };
  };
  if (replay && mutation.state === 'succeeded') {
    // Google already has it: finish only the local link if it was lost
    try {
      return await succeed(await api.getEvent(t, b.calendarId, eventId));
    } catch (e) {
      mapApiError(e, userId);
    }
  }
  const body: Partial<GEvent> & { id: string } = {
    id: eventId,
    summary: input.summary,
    description: input.description ?? '',
    location: input.location ?? '',
    ...times,
    ...(recurrence && recurrence.length ? { recurrence } : {}),
    extendedProperties: { private: { csbMutation: mutation.id, csbProduct: productId } },
  };
  try {
    return await succeed(await api.insertEvent(t, b.calendarId, body));
  } catch (e) {
    if (e instanceof CalendarApiError && e.kind === 'duplicate') {
      const existing = await api.getEvent(t, b.calendarId, eventId).catch(() => null);
      if (existing?.extendedProperties?.private?.csbMutation === mutation.id) return succeed(existing);
      await finishMutation(mutation.id, 'failed', { errorCode: 'duplicate_foreign' });
      throw new AppError('EVENT_CONFLICT', '活動識別碼衝突，請重新建立。');
    }
    if (e instanceof CalendarApiError && (e.kind === 'timeout' || e.kind === 'server')) {
      // outcome unknown: look it up by the deterministic id instead of creating again
      const existing = await api.getEvent(t, b.calendarId, eventId).catch(() => null);
      if (existing?.extendedProperties?.private?.csbMutation === mutation.id) return succeed(existing);
      await finishMutation(mutation.id, 'unknown', { errorCode: e.kind });
      return { state: 'unknown', mutationId: mutation.id };
    }
    await finishMutation(mutation.id, 'failed', { errorCode: e instanceof CalendarApiError ? e.kind : 'error' });
    mapApiError(e, userId);
  }
}

const EDITABLE_TIME_KEYS: (keyof EventFields)[] = ['allDay', 'startDateTime', 'endDateTime', 'startDate', 'endDateInclusive', 'timeZone'];

export async function updateEvent(
  userId: string, productId: string, eventId: string, key: string,
  input: EventFields & { scope: 'single' | 'series'; expectedEtag: string; bindingRevision: number },
): Promise<MutationOutcome> {
  const b = await requireBinding(productId, input.bindingRevision);
  const t = await token(userId);
  const api = getCalendarApi();
  const access = await calendarAccess(userId, b.calendarId);
  let target: GEvent;
  try {
    const clicked = await api.getEvent(t, b.calendarId, eventId);
    target = input.scope === 'series' && clicked.recurringEventId ? await api.getEvent(t, b.calendarId, clicked.recurringEventId) : clicked;
  } catch (e) {
    mapApiError(e, userId);
  }
  if (input.scope === 'series' && !target.recurrence) throw invalid('此活動不是重複活動。', { scope: '只能編輯本次' });
  if (input.scope === 'single' && target.recurrence) throw invalid('請選擇要修改本次或整個系列。', { scope: '重複活動需要選擇範圍' });
  const reason = readOnlyReason(target, access);
  if (reason === 'calendar_read_only') throw new AppError('CALENDAR_READ_ONLY', '你在 Google 對此日曆只有檢視權限。');
  if (reason) throw new AppError('UNSUPPORTED_EVENT_TYPE', '此活動含與會者、會議或特殊類型，請在 Google 日曆編輯。');
  const touchesTime = EDITABLE_TIME_KEYS.some((k) => input[k] !== undefined) || input.recurrence !== undefined;
  if (input.scope === 'series' && touchesTime && parseRecurrence(target.recurrence).kind === 'complex') {
    throw new AppError('UNSUPPORTED_RECURRENCE', '此系列使用平台不支援的重複規則，只能修改名稱、地點與說明。');
  }
  if (input.scope === 'single' && input.recurrence !== undefined) throw invalid('本次修改不能變更重複規則。', { recurrence: '請改選整個系列' });
  const patch: Partial<GEvent> = {};
  if (input.summary !== undefined) patch.summary = input.summary;
  if (input.description !== undefined) patch.description = input.description;
  if (input.location !== undefined) patch.location = input.location;
  if (touchesTime && EDITABLE_TIME_KEYS.some((k) => input[k] !== undefined)) Object.assign(patch, validateTimes(input, true));
  const tz = input.timeZone ?? target.start.timeZone ?? b.calendarTimezone;
  const allDay = input.allDay ?? Boolean(target.start.date);
  if (input.recurrence === null) throw invalid('第一版不支援移除重複設定，請在 Google 日曆調整。', { recurrence: '不支援移除' });
  const rec = recurrenceLines(input.recurrence, allDay, tz);
  if (rec !== undefined) patch.recurrence = rec;
  const { mutation, replay } = await beginMutation(userId, productId, key, 'update', b.calendarId, { ...input }, target.id);
  if (replay && mutation.state === 'succeeded') {
    const ev = await api.getEvent(t, b.calendarId, target.id).catch((e) => mapApiError(e, userId));
    return { state: 'succeeded', mutationId: mutation.id, event: eventDto(ev, access, null, b.calendarTimezone) };
  }
  if (replay && mutation.state === 'unknown') {
    // never blind-replay an update whose outcome is unknown: check first
    const ev = await api.getEvent(t, b.calendarId, target.id).catch(() => null);
    if (ev?.extendedProperties?.private?.csbLastMutation === mutation.id) {
      await finishMutation(mutation.id, 'succeeded', { result: { etag: ev.etag } });
      return { state: 'succeeded', mutationId: mutation.id, event: eventDto(ev, access, null, b.calendarTimezone) };
    }
  }
  // only allowlisted fields are sent; reminders and unsupported fields stay untouched in Google
  patch.extendedProperties = { private: { csbLastMutation: mutation.id } };
  try {
    const ev = await api.patchEvent(t, b.calendarId, target.id, patch, input.expectedEtag);
    await finishMutation(mutation.id, 'succeeded', { googleEventId: ev.id, result: { etag: ev.etag } });
    const links = await linksFor(getSql(), productId, b.calendarId, [ev.id, ...(ev.recurringEventId ? [ev.recurringEventId] : [])]);
    return { state: 'succeeded', mutationId: mutation.id, event: eventDto(ev, access, links.get(ev.id) ?? null, b.calendarTimezone) };
  } catch (e) {
    if (e instanceof CalendarApiError && (e.kind === 'timeout' || e.kind === 'server')) {
      const ev = await api.getEvent(t, b.calendarId, target.id).catch(() => null);
      if (ev?.extendedProperties?.private?.csbLastMutation === mutation.id) {
        await finishMutation(mutation.id, 'succeeded', { result: { etag: ev.etag } });
        return { state: 'succeeded', mutationId: mutation.id, event: eventDto(ev, access, null, b.calendarTimezone) };
      }
      await finishMutation(mutation.id, 'unknown', { errorCode: e.kind });
      return { state: 'unknown', mutationId: mutation.id };
    }
    await finishMutation(mutation.id, 'failed', { errorCode: e instanceof CalendarApiError ? e.kind : 'error' });
    mapApiError(e, userId);
  }
}

export async function deleteEvent(
  userId: string, productId: string, eventId: string, key: string,
  input: { scope: 'single' | 'series'; etag: string; bindingRevision: number },
): Promise<MutationOutcome> {
  const b = await requireBinding(productId, input.bindingRevision);
  const t = await token(userId);
  const api = getCalendarApi();
  const access = await calendarAccess(userId, b.calendarId);
  const { mutation, replay } = await beginMutation(userId, productId, key, 'delete', b.calendarId, input, eventId);
  if (replay && mutation.state === 'succeeded') return { state: 'succeeded', mutationId: mutation.id, event: null };
  let targetId = eventId;
  try {
    const clicked = await api.getEvent(t, b.calendarId, eventId);
    if (input.scope === 'series' && clicked.recurringEventId) targetId = clicked.recurringEventId;
    if (input.scope === 'single' && clicked.recurrence) throw invalid('請選擇要刪除本次或整個系列。', { scope: '重複活動需要選擇範圍' });
    const reason = readOnlyReason(clicked, access);
    if (reason === 'calendar_read_only') throw new AppError('CALENDAR_READ_ONLY', '你在 Google 對此日曆只有檢視權限。');
    if (reason) throw new AppError('UNSUPPORTED_EVENT_TYPE', '此活動含與會者、會議或特殊類型，請在 Google 日曆刪除。');
  } catch (e) {
    if (e instanceof CalendarApiError && (e.kind === 'not_found' || e.kind === 'gone') && replay) {
      // verified target from an earlier attempt of this same operation: deletion completed
      await finishMutation(mutation.id, 'succeeded');
      return { state: 'succeeded', mutationId: mutation.id, event: null };
    }
    if (!(e instanceof CalendarApiError)) await finishMutation(mutation.id, 'failed', { errorCode: 'validation' });
    mapApiError(e, userId);
  }
  try {
    await api.deleteEvent(t, b.calendarId, targetId, input.etag);
  } catch (e) {
    if (e instanceof CalendarApiError && (e.kind === 'gone' || e.kind === 'not_found') && replay) {
      await finishMutation(mutation.id, 'succeeded');
      return { state: 'succeeded', mutationId: mutation.id, event: null };
    }
    if (e instanceof CalendarApiError && (e.kind === 'timeout' || e.kind === 'server')) {
      await finishMutation(mutation.id, 'unknown', { errorCode: e.kind });
      return { state: 'unknown', mutationId: mutation.id };
    }
    await finishMutation(mutation.id, 'failed', { errorCode: e instanceof CalendarApiError ? e.kind : 'error' });
    mapApiError(e, userId);
  }
  await finishMutation(mutation.id, 'succeeded', { googleEventId: targetId });
  await getSql()`delete from calendar_event_links where product_id = ${productId} and calendar_id = ${b.calendarId} and event_id = ${targetId}`;
  return { state: 'succeeded', mutationId: mutation.id, event: null };
}

export async function setFeedbackLink(userId: string, productId: string, eventId: string, feedbackId: string | null) {
  const b = await requireBinding(productId);
  const t = await token(userId);
  try {
    await getCalendarApi().getEvent(t, b.calendarId, eventId); // must exist in the bound calendar and be visible to this user
  } catch (e) {
    mapApiError(e, userId);
  }
  if (feedbackId === null) {
    await getSql()`delete from calendar_event_links where product_id = ${productId} and calendar_id = ${b.calendarId} and event_id = ${eventId}`;
    return { feedbackLink: null };
  }
  await assertFeedbackInProduct(productId, feedbackId);
  // linking never changes the Feedback's schedule, status or tags
  await getSql()`
    insert into calendar_event_links (product_id, calendar_id, event_id, feedback_id, created_by)
    values (${productId}, ${b.calendarId}, ${eventId}, ${feedbackId}, ${userId})
    on conflict (calendar_id, event_id) do update set feedback_id = excluded.feedback_id, revision = calendar_event_links.revision + 1
  `;
  const [f] = await getSql()<{ title: string }[]>`select title from feedback where id = ${feedbackId}`;
  return { feedbackLink: { feedbackId, title: f.title } };
}
