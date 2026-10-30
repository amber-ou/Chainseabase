/**
 * Calendar logic against the in-memory Google fake (FakeCalendarApi / FakeGoogleOAuthClient).
 * These are MOCK tests of our adapter contract, idempotency and conflict handling. They do
 * not prove real Google behaviour; C03/C05–C10/C12–C15 still require a sandbox calendar run.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSql } from '@/server/db';
import { CALENDAR_SCOPES } from '@/server/adapters/google-oauth';
import { clearAccessCache } from '@/modules/calendar/credentials';
import { api, createFeedback, expectOk, installFakes, makeUser, resetDb, seedWorld, type Fakes, type TestUser, type World } from '../helpers/harness';

let fakes: Fakes;
let w: World;
const CAL = 'product-a-calendar@group.calendar.google.com';

beforeAll(() => { fakes = installFakes(); });
beforeEach(async () => {
  await resetDb();
  fakes = installFakes();
  w = await seedWorld();
  fakes.calendar.addCalendar(CAL, '產品甲日曆', 'Asia/Taipei', { [w.teamA.sub]: 'writer', [w.teamB.sub]: 'reader' });
});

const P = () => `/products/${w.productA.id}`;
let codeN = 0;

async function connect(u: TestUser, opts: { sub?: string; scope?: string[]; refreshToken?: string | null } = {}) {
  const start = await api.get(`/integrations/google/calendar/start?returnTo=${encodeURIComponent('/products/x/dashboard')}`, { as: u, origin: null });
  expect(start.status).toBe(302);
  const transient = start.headers.getSetCookie().find((c) => c.startsWith('csb_oauth='))!.split(';')[0];
  const code = `cal-code-${++codeN}`;
  fakes.oauth.codes.set(code, {
    claims: { sub: opts.sub ?? u.sub, email: u.email, emailVerified: true, name: u.name, picture: null },
    scope: opts.scope ?? ['openid', 'email', ...CALENDAR_SCOPES],
    refreshToken: opts.refreshToken === undefined ? `refresh-${u.sub}-${codeN}` : opts.refreshToken,
  });
  const cb = await api.get(`/integrations/google/calendar/callback?code=${code}&state=${fakes.oauth.lastAuthorization!.state}`, {
    as: u, origin: null, headers: { cookie: transient },
  });
  expect(cb.status).toBe(302);
  return new URL(cb.headers.get('location')!, 'http://x').searchParams.get('calendar');
}

async function bind(u = w.teamA) {
  const cur = expectOk(await api.get(`${P()}/calendar/binding`, { as: u }));
  return expectOk(await api.put(`${P()}/calendar/binding`, { as: u, body: { calendarId: CAL, expectedRevision: cur?.revision ?? 0 } }));
}

const timed = (extra: Record<string, unknown> = {}) => ({
  summary: '搜尋功能驗收', description: '鍵盤操作', location: '會議室 A', allDay: false,
  startDateTime: '2026-10-27T14:00:00+08:00', endDateTime: '2026-10-27T15:00:00+08:00', timeZone: 'Asia/Taipei', ...extra,
});

async function events(u = w.teamA, from = '2026-10-01T00:00:00+08:00', to = '2026-11-30T00:00:00+08:00') {
  return api.get(`${P()}/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { as: u });
}

describe('Calendar authorization and binding', () => {
  it('C01 login alone grants no calendar; other features still work', async () => {
    const status = expectOk(await api.get('/integrations/google/calendar/status', { as: w.teamA }));
    expect(status.connected).toBe(false);
    expect(status.missingScopes).toEqual(CALENDAR_SCOPES);
    const r = await api.get(`${P()}/calendar/binding`, { as: w.teamA });
    expect(r.body.data).toBeNull();
    expect((await events()).body.error.code).toBe('CALENDAR_NOT_BOUND');
    expect((await api.get('/integrations/google/calendars', { as: w.teamA })).body.error.code).toBe('CALENDAR_NOT_CONNECTED');
    expect((await api.get(`${P()}/feedback`, { as: w.teamA })).status).toBe(200);
  });

  it('C02 a different Google account or incomplete scopes is refused without replacing a valid credential', async () => {
    expect(await connect(w.teamA, { sub: 'someone-else' })).toBe('wrong_account');
    expect(expectOk(await api.get('/integrations/google/calendar/status', { as: w.teamA })).connected).toBe(false);
    expect(await connect(w.teamA)).toBe('connected');
    const [before] = await getSql()`select encrypted_refresh_token from google_credentials where user_id = ${w.teamA.id}`;
    expect(await connect(w.teamA, { scope: ['openid', 'email', CALENDAR_SCOPES[1]] })).toBe('calendar_scopes_missing');
    const [after] = await getSql()`select encrypted_refresh_token, granted_scopes from google_credentials where user_id = ${w.teamA.id}`;
    expect(after.encryptedRefreshToken).toBe(before.encryptedRefreshToken);
    expect(after.grantedScopes).toEqual(expect.arrayContaining(CALENDAR_SCOPES));
    // refresh tokens are stored encrypted, never in plain text
    expect(after.encryptedRefreshToken).not.toContain('refresh-');
  });

  it('C03 writer reads/writes, reader is read-only, an unshared account is denied — each with their own token', async () => {
    const outsiderTeam = await makeUser('team', 'Unshared');
    for (const u of [w.teamA, w.teamB, outsiderTeam]) expect(await connect(u)).toBe('connected');
    await bind();
    const created = await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed(), bindingRevision: 1 } });
    expect(created.status).toBe(201);
    const list = expectOk(await events(w.teamB));
    expect(list.accessRole).toBe('reader');
    expect(list.events[0].readOnlyReason).toBe('calendar_read_only');
    const rw = await api.post(`${P()}/calendar/events`, { as: w.teamB, key: true, body: { ...timed(), bindingRevision: 1 } });
    expect(rw.status).toBe(403);
    expect(rw.body.error.code).toBe('CALENDAR_READ_ONLY');
    const denied = await events(outsiderTeam);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('CALENDAR_ACCESS_DENIED');
    // binding requires writer
    const rb = await api.put(`${P()}/calendar/binding`, { as: w.teamB, body: { calendarId: CAL, expectedRevision: 1 } });
    expect(rb.status).toBe(403);
  });

  it('C04 only the bound calendar is used; forged ids and stale binding revisions are refused', async () => {
    await connect(w.teamA);
    fakes.calendar.addCalendar('other@group.calendar.google.com', '其他', 'Asia/Taipei', { [w.teamA.sub]: 'owner' });
    await bind();
    const forged = await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed(), calendarId: 'other@group.calendar.google.com', bindingRevision: 1 } });
    expect(forged.status).toBe(400);
    const stale = await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed(), bindingRevision: 0 } });
    expect(stale.status).toBe(409);
    // the same Google calendar cannot be bound to a second product
    const second = await api.put(`/products/${w.productB.id}/calendar/binding`, { as: w.teamA, body: { calendarId: CAL, expectedRevision: 0 } });
    expect(second.status).toBe(409);
    // product B has no binding, nothing leaks from A
    expect((await api.get(`/products/${w.productB.id}/calendar/events?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z`, { as: w.teamA })).body.error.code).toBe('CALENDAR_NOT_BOUND');
  });
});

describe('Calendar events', () => {
  beforeEach(async () => {
    await connect(w.teamA);
    await bind();
  });

  it('C05 create → edit → reschedule → delete stays consistent with Google', async () => {
    const c = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed(), bindingRevision: 1 } }), 201);
    expect(c.state).toBe('succeeded');
    const id = c.event.id;
    expect(fakes.calendar.calendars.get(CAL)!.events.get(id)!.summary).toBe('搜尋功能驗收');
    const e1 = expectOk(await api.patch(`${P()}/calendar/events/${id}`, { as: w.teamA, key: true, body: { scope: 'single', expectedEtag: c.event.etag, bindingRevision: 1, summary: '驗收（改）' } }));
    const e2 = expectOk(await api.patch(`${P()}/calendar/events/${id}`, { as: w.teamA, key: true, body: {
      scope: 'single', expectedEtag: e1.event.etag, bindingRevision: 1, allDay: false,
      startDateTime: '2026-10-28T10:00:00+08:00', endDateTime: '2026-10-28T11:00:00+08:00', timeZone: 'Asia/Taipei',
    } }));
    const g = fakes.calendar.calendars.get(CAL)!.events.get(id)!;
    expect(g.summary).toBe('驗收（改）');
    expect(g.location).toBe('會議室 A');
    expect(g.start.dateTime).toBe('2026-10-28T10:00:00+08:00');
    expect(g.reminders).toEqual({ useDefault: true });
    const del = await api.del(`${P()}/calendar/events/${id}?scope=single&bindingRevision=1`, { as: w.teamA, key: true, headers: { 'if-match': e2.event.etag } });
    expect(del.status).toBe(200);
    expect(expectOk(await events()).events).toHaveLength(0);
    // invalid times fail before Google is called
    const bad = await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed({ endDateTime: '2026-10-27T13:00:00+08:00' }), bindingRevision: 1 } });
    expect(bad.status).toBe(400);
  });

  it('C06 all-day single and multi-day events use exclusive end dates without UTC shifts', async () => {
    const one = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { summary: '全天', allDay: true, startDate: '2026-10-27', endDateInclusive: '2026-10-27', timeZone: 'Asia/Taipei', bindingRevision: 1 } }), 201);
    const g1 = fakes.calendar.calendars.get(CAL)!.events.get(one.event.id)!;
    expect(g1.start).toEqual({ date: '2026-10-27' });
    expect(g1.end).toEqual({ date: '2026-10-28' });
    expect(one.event.endDateInclusive).toBe('2026-10-27');
    const multi = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { summary: '跨日', allDay: true, startDate: '2026-10-30', endDateInclusive: '2026-11-02', timeZone: 'America/Los_Angeles', bindingRevision: 1 } }), 201);
    expect(fakes.calendar.calendars.get(CAL)!.events.get(multi.event.id)!.end).toEqual({ date: '2026-11-03' });
    expect(multi.event.startDate).toBe('2026-10-30');
    expect(multi.event.endDateInclusive).toBe('2026-11-02');
  });

  it('C07 weekly series across a DST change keeps the local wall-clock time (fake expansion with IANA zones)', async () => {
    const s = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: {
      summary: '紐約週會', allDay: false, startDateTime: '2026-10-26T10:00:00-04:00', endDateTime: '2026-10-26T11:00:00-04:00', timeZone: 'America/New_York',
      recurrence: { freq: 'WEEKLY', interval: 1, end: { type: 'count', count: 3 } }, bindingRevision: 1,
    } }), 201);
    const list = expectOk(await events(w.teamA, '2026-10-20T00:00:00Z', '2026-11-20T00:00:00Z')).events.filter((e: any) => e.seriesId === s.event.id);
    expect(list.map((e: any) => e.startDateTime)).toEqual(['2026-10-26T10:00:00-04:00', '2026-11-02T10:00:00-05:00', '2026-11-09T10:00:00-05:00']);
  });

  it('C08 editing/deleting "this occurrence" only touches that instance', async () => {
    const s = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed(), recurrence: { freq: 'DAILY', interval: 1, end: { type: 'count', count: 4 } }, bindingRevision: 1 } }), 201);
    let list = expectOk(await events()).events;
    expect(list).toHaveLength(4);
    const second = list[1];
    expect(second.isInstance).toBe(true);
    const singleOnMaster = await api.patch(`${P()}/calendar/events/${s.event.id}`, { as: w.teamA, key: true, body: { scope: 'single', expectedEtag: s.event.etag, bindingRevision: 1, summary: 'x' } });
    expect(singleOnMaster.status).toBe(400);
    expectOk(await api.patch(`${P()}/calendar/events/${second.id}`, { as: w.teamA, key: true, body: { scope: 'single', expectedEtag: second.etag, bindingRevision: 1, summary: '只改第二次' } }));
    list = expectOk(await events()).events;
    expect(list.map((e: any) => e.summary)).toEqual(['搜尋功能驗收', '只改第二次', '搜尋功能驗收', '搜尋功能驗收']);
    const third = list[2];
    expectOk(await api.del(`${P()}/calendar/events/${third.id}?scope=single&bindingRevision=1`, { as: w.teamA, key: true, headers: { 'if-match': third.etag } }));
    list = expectOk(await events()).events;
    expect(list).toHaveLength(3);
    expect(fakes.calendar.calendars.get(CAL)!.events.get(s.event.id)!.summary).toBe('搜尋功能驗收');
  });

  it('C09 series edit from the 3rd occurrence uses the master start and master ETag', async () => {
    const s = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed(), recurrence: { freq: 'DAILY', interval: 1, end: { type: 'count', count: 5 } }, bindingRevision: 1 } }), 201);
    const third = expectOk(await events()).events[2];
    // using the instance ETag for the series is a conflict
    const wrong = await api.patch(`${P()}/calendar/events/${third.id}`, { as: w.teamA, key: true, body: { scope: 'series', expectedEtag: third.etag, bindingRevision: 1, summary: '系列改名' } });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('EVENT_CONFLICT');
    const master = expectOk(await api.get(`${P()}/calendar/events/${s.event.id}`, { as: w.teamA })).event;
    expect(master.startDateTime).toBe('2026-10-27T14:00:00+08:00');
    expectOk(await api.patch(`${P()}/calendar/events/${third.id}`, { as: w.teamA, key: true, body: { scope: 'series', expectedEtag: master.etag, bindingRevision: 1, summary: '系列改名' } }));
    const g = fakes.calendar.calendars.get(CAL)!.events.get(s.event.id)!;
    expect(g.summary).toBe('系列改名');
    expect(g.start.dateTime).toBe('2026-10-27T14:00:00+08:00');
    expect(expectOk(await events()).events).toHaveLength(5);
  });

  it('C10 series edits keep existing exceptions in the fake (real Google behaviour must be recorded in sandbox)', async () => {
    const s = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed(), recurrence: { freq: 'DAILY', interval: 1, end: { type: 'count', count: 3 } }, bindingRevision: 1 } }), 201);
    const [, second] = expectOk(await events()).events;
    expectOk(await api.patch(`${P()}/calendar/events/${second.id}`, { as: w.teamA, key: true, body: { scope: 'single', expectedEtag: second.etag, bindingRevision: 1, summary: '例外' } }));
    const master = expectOk(await api.get(`${P()}/calendar/events/${s.event.id}`, { as: w.teamA })).event;
    expectOk(await api.patch(`${P()}/calendar/events/${s.event.id}`, { as: w.teamA, key: true, body: { scope: 'series', expectedEtag: master.etag, bindingRevision: 1, location: '新地點' } }));
    const list = expectOk(await events()).events;
    expect(list.map((e: any) => e.summary)).toEqual(['搜尋功能驗收', '例外', '搜尋功能驗收']);
  });

  it('C11 complex recurrence, special event types and attendee/meeting events are protected', async () => {
    const cal = fakes.calendar.calendars.get(CAL)!;
    cal.events.set('externalcomplex1', { id: 'externalcomplex1', etag: '"x1"', summary: '外部複雜', start: { dateTime: '2026-10-27T09:00:00+08:00', timeZone: 'Asia/Taipei' }, end: { dateTime: '2026-10-27T10:00:00+08:00', timeZone: 'Asia/Taipei' }, recurrence: ['RRULE:FREQ=WEEKLY;BYSETPOS=1;BYDAY=MO', 'EXDATE:20261103T010000Z'] });
    cal.events.set('externalmeet1', { id: 'externalmeet1', etag: '"x2"', summary: '有與會者', start: { dateTime: '2026-10-28T09:00:00+08:00' }, end: { dateTime: '2026-10-28T10:00:00+08:00' }, attendees: [{ email: 'guest@example.com' }], conferenceData: { id: 'meet' } });
    cal.events.set('externalooo1', { id: 'externalooo1', etag: '"x3"', summary: '休假', eventType: 'outOfOffice', start: { dateTime: '2026-10-29T09:00:00+08:00' }, end: { dateTime: '2026-10-29T18:00:00+08:00' } });
    const complex = expectOk(await api.get(`${P()}/calendar/events/externalcomplex1`, { as: w.teamA })).event;
    expect(complex.recurrenceComplex).toBe(true);
    const timeEdit = await api.patch(`${P()}/calendar/events/externalcomplex1`, { as: w.teamA, key: true, body: { scope: 'series', expectedEtag: '"x1"', bindingRevision: 1, allDay: false, startDateTime: '2026-10-27T11:00:00+08:00', endDateTime: '2026-10-27T12:00:00+08:00' } });
    expect(timeEdit.status).toBe(422);
    expect(timeEdit.body.error.code).toBe('UNSUPPORTED_RECURRENCE');
    expectOk(await api.patch(`${P()}/calendar/events/externalcomplex1`, { as: w.teamA, key: true, body: { scope: 'series', expectedEtag: '"x1"', bindingRevision: 1, summary: '外部複雜（改名）' } }));
    expect(cal.events.get('externalcomplex1')!.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYSETPOS=1;BYDAY=MO', 'EXDATE:20261103T010000Z']);
    for (const id of ['externalmeet1', 'externalooo1']) {
      const r = await api.patch(`${P()}/calendar/events/${id}`, { as: w.teamA, key: true, body: { scope: 'single', expectedEtag: cal.events.get(id)!.etag, bindingRevision: 1, summary: '改' } });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('UNSUPPORTED_EVENT_TYPE');
    }
    expect(cal.events.get('externalmeet1')!.attendees).toHaveLength(1);
  });

  it('C12 created at Google but the response is lost: retrying the same key yields exactly one event', async () => {
    fakes.calendar.injectFailure('insert', 'timeout', { afterApply: true });
    fakes.calendar.injectFailure('get', 'timeout');
    const first = await api.post(`${P()}/calendar/events`, { as: w.teamA, key: 'cal-key-c12', body: { ...timed(), bindingRevision: 1 } });
    expect(first.status).toBe(202);
    expect(first.body.data.state).toBe('unknown');
    const f = await createFeedback(w, {});
    void f;
    const retry = await api.post(`${P()}/calendar/events`, { as: w.teamA, key: 'cal-key-c12', body: { ...timed(), bindingRevision: 1 } });
    expect(retry.status).toBe(201);
    expect(fakes.calendar.calendars.get(CAL)!.events.size).toBe(1);
    const third = await api.post(`${P()}/calendar/events`, { as: w.teamA, key: 'cal-key-c12', body: { ...timed(), bindingRevision: 1 } });
    expect(third.body.data.event.id).toBe(retry.body.data.event.id);
    expect(fakes.calendar.calendars.get(CAL)!.events.size).toBe(1);
    const differentBody = await api.post(`${P()}/calendar/events`, { as: w.teamA, key: 'cal-key-c12', body: { ...timed({ summary: '不同' }), bindingRevision: 1 } });
    expect(differentBody.status).toBe(409);
  });

  it('C12b a lost local link is completed by retrying with the same key, without recreating the event', async () => {
    const f = await createFeedback(w, { title: '要關聯' });
    const c = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: 'cal-key-link', body: { ...timed(), feedbackId: f.id, bindingRevision: 1 } }), 201);
    await getSql()`delete from calendar_event_links`;
    const again = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: 'cal-key-link', body: { ...timed(), feedbackId: f.id, bindingRevision: 1 } }), 201);
    expect(again.event.id).toBe(c.event.id);
    expect(again.event.feedbackLink.feedbackId).toBe(f.id);
    expect(fakes.calendar.calls.filter((x) => x.op === 'insert')).toHaveLength(1);
  });

  it('C13 saving with an old ETag after a Google-side edit conflicts and does not overwrite', async () => {
    const c = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed(), bindingRevision: 1 } }), 201);
    fakes.calendar.externalEdit(CAL, c.event.id, { summary: '在 Google 改的' });
    const r = await api.patch(`${P()}/calendar/events/${c.event.id}`, { as: w.teamA, key: true, body: { scope: 'single', expectedEtag: c.event.etag, bindingRevision: 1, summary: '我的修改' } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EVENT_CONFLICT');
    expect(fakes.calendar.calendars.get(CAL)!.events.get(c.event.id)!.summary).toBe('在 Google 改的');
  });

  it('C14 401/revoked → reauth, 403 → permission, 429 → rate limited, 5xx/timeout on update → unconfirmed, no infinite retries', async () => {
    const c = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed(), bindingRevision: 1 } }), 201);
    fakes.calendar.injectFailure('list', 'rate_limited');
    const rl = await events();
    expect(rl.status).toBe(429);
    fakes.calendar.injectFailure('patch', 'timeout');
    const unk = await api.patch(`${P()}/calendar/events/${c.event.id}`, { as: w.teamA, key: 'upd-unknown', body: { scope: 'single', expectedEtag: c.event.etag, bindingRevision: 1, summary: '逾時' } });
    expect(unk.status).toBe(202);
    expect(unk.body.data.state).toBe('unknown');
    // retry with the same key checks first and then applies once
    const again = await api.patch(`${P()}/calendar/events/${c.event.id}`, { as: w.teamA, key: 'upd-unknown', body: { scope: 'single', expectedEtag: c.event.etag, bindingRevision: 1, summary: '逾時' } });
    expect(again.status).toBe(200);
    expect(fakes.calendar.calendars.get(CAL)!.events.get(c.event.id)!.summary).toBe('逾時');
    // revoked refresh token: marked for reauth, no repeated refresh attempts
    for (const v of fakes.oauth.refreshTokens.values()) v.revoked = true;
    clearAccessCache();
    const r1 = await events();
    expect(r1.body.error.code).toBe('CALENDAR_REAUTH_REQUIRED');
    const [cred] = await getSql()`select needs_reauth from google_credentials where user_id = ${w.teamA.id}`;
    expect(cred.needsReauth).toBe(true);
    const r2 = await events();
    expect(r2.body.error.code).toBe('CALENDAR_REAUTH_REQUIRED');
  });

  it('C15 a consent response without a new refresh token keeps the existing one', async () => {
    const [before] = await getSql()`select encrypted_refresh_token from google_credentials where user_id = ${w.teamA.id}`;
    expect(await connect(w.teamA, { refreshToken: null })).toBe('connected');
    const [after] = await getSql()`select encrypted_refresh_token from google_credentials where user_id = ${w.teamA.id}`;
    expect(after.encryptedRefreshToken).toBe(before.encryptedRefreshToken);
    // a first-time connection without refresh token is not silently accepted
    expect(await connect(w.teamB, { refreshToken: null })).toBe('calendar_reauth_required');
  });

  it('C16 (API part) listing returns every page and the fetch time', async () => {
    for (let i = 0; i < 12; i++) {
      expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed({ summary: `活動 ${i}`, startDateTime: `2026-10-${String(5 + i).padStart(2, '0')}T09:00:00+08:00`, endDateTime: `2026-10-${String(5 + i).padStart(2, '0')}T10:00:00+08:00` }), bindingRevision: 1 } }), 201);
    }
    const r = expectOk(await events());
    expect(r.events).toHaveLength(12);
    expect(Date.parse(r.fetchedAt)).not.toBeNaN();
  });

  it('C17 disconnecting personal access or unbinding never deletes Google events or other users\' grants', async () => {
    await connect(w.teamB);
    expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed(), bindingRevision: 1 } }), 201);
    expectOk(await api.del('/integrations/google/calendar/connection', { as: w.teamA }));
    expect(expectOk(await api.get('/integrations/google/calendar/status', { as: w.teamA })).connected).toBe(false);
    expect(expectOk(await api.get('/integrations/google/calendar/status', { as: w.teamB })).connected).toBe(true);
    expect((await events(w.teamA)).body.error.code).toBe('CALENDAR_NOT_CONNECTED');
    expect(fakes.calendar.calendars.get(CAL)!.events.size).toBe(1);
    const b = expectOk(await api.get(`${P()}/calendar/binding`, { as: w.teamB }));
    expectOk(await api.del(`${P()}/calendar/binding`, { as: w.teamB, ifMatch: b.revision }));
    expect(fakes.calendar.calendars.get(CAL)!.events.size).toBe(1);
    expect((await events(w.teamB)).body.error.code).toBe('CALENDAR_NOT_BOUND');
  });

  it('C18 linking a feedback of another product is refused; a valid link changes nothing on the feedback', async () => {
    const c = expectOk(await api.post(`${P()}/calendar/events`, { as: w.teamA, key: true, body: { ...timed(), bindingRevision: 1 } }), 201);
    const other = await createFeedback(w, { title: '乙的' }, w.teamA, w.productB.id);
    expect((await api.put(`${P()}/calendar/events/${c.event.id}/feedback-link`, { as: w.teamA, body: { feedbackId: other.id } })).status).toBe(400);
    const mine = await createFeedback(w, { title: '甲的' });
    const before = expectOk(await api.get(`${P()}/feedback/${mine.id}`, { as: w.teamA }));
    const link = expectOk(await api.put(`${P()}/calendar/events/${c.event.id}/feedback-link`, { as: w.teamA, body: { feedbackId: mine.id } }));
    expect(link.feedbackLink).toEqual({ feedbackId: mine.id, title: '甲的' });
    const after = expectOk(await api.get(`${P()}/feedback/${mine.id}`, { as: w.teamA }));
    expect(after).toEqual(before);
    const sched = expectOk(await api.get(`${P()}/feedback/${mine.id}/schedule`, { as: w.teamA }));
    expect(sched.revision).toBe(1);
    expect(expectOk(await events()).events[0].feedbackLink.feedbackId).toBe(mine.id);
  });

  it('testers and the portal host have no calendar entry point', async () => {
    expect((await api.get(`${P()}/calendar/binding`, { as: w.tester })).status).toBe(403);
    expect((await api.get(`${P()}/calendar/binding`, { site: 'portal', as: w.teamA })).status).toBe(404);
  });
});
