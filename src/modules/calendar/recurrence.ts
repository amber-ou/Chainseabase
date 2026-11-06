import { DateTime, IANAZone } from 'luxon';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface RecurrenceInput {
  freq: Freq;
  interval: number;
  end: { type: 'never' } | { type: 'count'; count: number } | { type: 'until'; until: string };
  byDay?: Weekday[];
}

export function isValidTimeZone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDate(s: string): boolean {
  return DATE_RE.test(s) && DateTime.fromISO(s).isValid;
}

/** All-day: UI end date is inclusive, Google end.date is exclusive. No UTC conversion involved. */
export function allDayToGoogle(startDate: string, endDateInclusive: string) {
  const end = DateTime.fromISO(endDateInclusive).plus({ days: 1 }).toISODate()!;
  return { start: { date: startDate }, end: { date: end } };
}

export function allDayFromGoogle(startDate: string, endDateExclusive: string) {
  return { startDate, endDateInclusive: DateTime.fromISO(endDateExclusive).minus({ days: 1 }).toISODate()! };
}

/** Build a basic RRULE line. UNTIL for timed events is the end of that local day in UTC. */
export function buildRRule(r: RecurrenceInput, opts: { allDay: boolean; timeZone: string }): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'WEEKLY' && r.byDay?.length) parts.push(`BYDAY=${[...new Set(r.byDay)].join(',')}`);
  if (r.end.type === 'count') parts.push(`COUNT=${r.end.count}`);
  if (r.end.type === 'until') {
    if (opts.allDay) parts.push(`UNTIL=${r.end.until.replace(/-/g, '')}`);
    else {
      const until = DateTime.fromISO(r.end.until, { zone: opts.timeZone }).endOf('day').toUTC();
      parts.push(`UNTIL=${until.toFormat("yyyyMMdd'T'HHmmss'Z'")}`);
    }
  }
  return `RRULE:${parts.join(';')}`;
}

export type ParsedRecurrence = { kind: 'none' } | { kind: 'basic'; rule: RecurrenceInput } | { kind: 'complex' };

/** Only single basic RRULEs are editable in the platform; anything else stays as-is (read-only rule). */
export function parseRecurrence(lines: string[] | undefined | null, timeZone = 'UTC'): ParsedRecurrence {
  if (!lines || lines.length === 0) return { kind: 'none' };
  if (lines.length !== 1 || !lines[0].startsWith('RRULE:')) return { kind: 'complex' };
  const kv = new Map<string, string>();
  for (const p of lines[0].slice(6).split(';')) {
    const [k, v] = p.split('=');
    if (!k || v === undefined || kv.has(k)) return { kind: 'complex' };
    kv.set(k.toUpperCase(), v.toUpperCase());
  }
  const allowed = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY']);
  for (const k of kv.keys()) if (!allowed.has(k)) return { kind: 'complex' };
  const freq = kv.get('FREQ') as Freq | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq)) return { kind: 'complex' };
  const interval = kv.has('INTERVAL') ? Number(kv.get('INTERVAL')) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return { kind: 'complex' };
  if (kv.has('COUNT') && kv.has('UNTIL')) return { kind: 'complex' };
  let byDay: Weekday[] | undefined;
  if (kv.has('BYDAY')) {
    if (freq !== 'WEEKLY') return { kind: 'complex' };
    const days = kv.get('BYDAY')!.split(',');
    if (!days.every((d) => (WEEKDAYS as readonly string[]).includes(d))) return { kind: 'complex' };
    byDay = days as Weekday[];
  }
  let end: RecurrenceInput['end'] = { type: 'never' };
  if (kv.has('COUNT')) {
    const count = Number(kv.get('COUNT'));
    if (!Number.isInteger(count) || count < 1 || count > 730) return { kind: 'complex' };
    end = { type: 'count', count };
  } else if (kv.has('UNTIL')) {
    const raw = kv.get('UNTIL')!;
    const m = /^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z)?$/.exec(raw);
    if (!m) return { kind: 'complex' };
    const until = m[4]
      ? DateTime.fromObject({ year: +m[1], month: +m[2], day: +m[3], hour: +m[5], minute: +m[6], second: +m[7] }, { zone: 'UTC' }).setZone(timeZone).toISODate()!
      : `${m[1]}-${m[2]}-${m[3]}`;
    end = { type: 'until', until };
  }
  return { kind: 'basic', rule: { freq, interval, end, ...(byDay ? { byDay } : {}) } };
}

const WEEKDAY_NUM: Record<Weekday, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

/**
 * Expand occurrences of a basic rule in the event's IANA zone (DST-correct:
 * the local wall time stays fixed, offsets follow the zone).
 */
export function expandOccurrences(
  start: DateTime, rule: RecurrenceInput, opts: { windowStart: DateTime; windowEnd: DateTime; allDay: boolean; max?: number },
): DateTime[] {
  const out: DateTime[] = [];
  const max = opts.max ?? 1000;
  const untilEnd = rule.end.type === 'until'
    ? (opts.allDay ? DateTime.fromISO(rule.end.until, { zone: start.zone }).endOf('day') : DateTime.fromISO(rule.end.until, { zone: start.zone }).endOf('day'))
    : null;
  const countLimit = rule.end.type === 'count' ? rule.end.count : Infinity;
  let produced = 0;
  const push = (d: DateTime) => {
    if (produced >= countLimit) return false;
    if (untilEnd && d > untilEnd) return false;
    produced++;
    if (d >= opts.windowStart.minus({ days: opts.allDay ? 1 : 0 }) && d < opts.windowEnd) out.push(d);
    return out.length < max;
  };
  for (let i = 0; i < 5000; i++) {
    if (rule.freq === 'DAILY') {
      const d = start.plus({ days: i * rule.interval });
      if (d >= opts.windowEnd && !untilEnd && countLimit === Infinity) break;
      if (!push(d) || d >= opts.windowEnd) break;
    } else if (rule.freq === 'MONTHLY') {
      const d = start.plus({ months: i * rule.interval });
      if (d.day !== start.day) continue; // e.g. 31st skips shorter months like Google
      if (!push(d) || d >= opts.windowEnd) break;
    } else {
      const weekStart = start.startOf('week').plus({ weeks: i * rule.interval });
      const days = (rule.byDay?.length ? rule.byDay : [WEEKDAYS[start.weekday - 1]]).map((w) => WEEKDAY_NUM[w]).sort((a, b) => a - b);
      let stop = false;
      for (const wd of days) {
        const d = weekStart.plus({ days: wd - 1 }).set({ hour: start.hour, minute: start.minute, second: start.second, millisecond: 0 });
        if (d < start) continue;
        if (!push(d) || d >= opts.windowEnd) { stop = true; break; }
      }
      if (stop) break;
    }
    if (produced >= countLimit) break;
  }
  return out;
}

/** Google-style instance id: <seriesId>_<UTC basic time> (timed) or <seriesId>_<yyyymmdd> (all-day). */
export function instanceId(seriesId: string, occurrence: DateTime, allDay: boolean): string {
  return allDay ? `${seriesId}_${occurrence.toFormat('yyyyMMdd')}` : `${seriesId}_${occurrence.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`;
}
