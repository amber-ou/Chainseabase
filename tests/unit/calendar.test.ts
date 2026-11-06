import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { allDayFromGoogle, allDayToGoogle, buildRRule, expandOccurrences, instanceId, parseRecurrence } from '@/modules/calendar/recurrence';
import { deterministicEventId, readOnlyReason } from '@/modules/calendar/service';

describe('all-day conversions', () => {
  it('uses an exclusive Google end date and no UTC conversion', () => {
    expect(allDayToGoogle('2026-10-27', '2026-10-27')).toEqual({ start: { date: '2026-10-27' }, end: { date: '2026-10-28' } });
    expect(allDayToGoogle('2026-12-31', '2027-01-01')).toEqual({ start: { date: '2026-12-31' }, end: { date: '2027-01-02' } });
    expect(allDayFromGoogle('2026-10-27', '2026-10-28')).toEqual({ startDate: '2026-10-27', endDateInclusive: '2026-10-27' });
    expect(allDayToGoogle('2028-02-28', '2028-02-29').end.date).toBe('2028-03-01');
  });
});

describe('recurrence rules', () => {
  it('builds and parses basic rules round trip', () => {
    const rule = { freq: 'WEEKLY' as const, interval: 2, end: { type: 'count' as const, count: 5 }, byDay: ['MO' as const, 'WE' as const] };
    const line = buildRRule(rule, { allDay: false, timeZone: 'Asia/Taipei' });
    expect(line).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5');
    expect(parseRecurrence([line])).toEqual({ kind: 'basic', rule });
    const until = buildRRule({ freq: 'DAILY', interval: 1, end: { type: 'until', until: '2026-11-30' } }, { allDay: false, timeZone: 'Asia/Taipei' });
    expect(until).toBe('RRULE:FREQ=DAILY;UNTIL=20261130T155959Z');
    expect(parseRecurrence([until], 'Asia/Taipei')).toEqual({ kind: 'basic', rule: { freq: 'DAILY', interval: 1, end: { type: 'until', until: '2026-11-30' } } });
    expect(buildRRule({ freq: 'MONTHLY', interval: 1, end: { type: 'until', until: '2027-01-31' } }, { allDay: true, timeZone: 'Asia/Taipei' })).toBe('RRULE:FREQ=MONTHLY;UNTIL=20270131');
  });
  it('marks anything beyond the basic subset as complex (kept read-only, never downgraded)', () => {
    for (const r of [['RRULE:FREQ=YEARLY'], ['RRULE:FREQ=WEEKLY;BYSETPOS=1;BYDAY=MO'], ['RRULE:FREQ=DAILY', 'EXDATE:20261101T000000Z'], ['RDATE:20261101'], ['RRULE:FREQ=MONTHLY;BYDAY=1MO'], ['RRULE:FREQ=DAILY;COUNT=2;UNTIL=20261101']]) {
      expect(parseRecurrence(r).kind, r.join()).toBe('complex');
    }
    expect(parseRecurrence(undefined)).toEqual({ kind: 'none' });
  });
  it('expands across DST keeping the local time (America/New_York)', () => {
    const start = DateTime.fromISO('2026-10-26T10:00:00', { zone: 'America/New_York' });
    const occ = expandOccurrences(start, { freq: 'WEEKLY', interval: 1, end: { type: 'count', count: 3 } }, { windowStart: start.minus({ days: 1 }), windowEnd: start.plus({ months: 2 }), allDay: false });
    expect(occ.map((d) => d.toISO({ suppressMilliseconds: true }))).toEqual(['2026-10-26T10:00:00-04:00', '2026-11-02T10:00:00-05:00', '2026-11-09T10:00:00-05:00']);
    expect(instanceId('abc', occ[1], false)).toBe('abc_20261102T150000Z');
  });
});

describe('calendar helpers', () => {
  it('generates stable Google-compatible event ids per mutation', () => {
    const id = deterministicEventId('11111111-1111-1111-1111-111111111111');
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(deterministicEventId('11111111-1111-1111-1111-111111111111')).toBe(id);
    expect(deterministicEventId('22222222-2222-2222-2222-222222222222')).not.toBe(id);
  });
  it('flags read-only reasons', () => {
    const base = { id: 'e', etag: '"1"', start: {}, end: {} };
    expect(readOnlyReason(base, 'reader')).toBe('calendar_read_only');
    expect(readOnlyReason({ ...base, attendees: [{}] }, 'writer')).toBe('has_attendees_or_meeting');
    expect(readOnlyReason({ ...base, eventType: 'focusTime' }, 'owner')).toBe('special_event_type');
    expect(readOnlyReason(base, 'writer')).toBeNull();
  });
});
