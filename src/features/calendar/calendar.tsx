'use client';

import { DateTime } from 'luxon';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, errorMessage, newKey } from '@/client/api';
import { useDebounced, useResource, useVisiblePolling } from '@/client/hooks';
import { useSite } from '@/client/site';
import { DISPLAY_TZ, formatDateTime } from '@/client/format';
import { Button, DeniedState, EmptyState, ErrorState, Field, LoadingState, Spinner, Switch } from '@/components/ui';
import { ConfirmModal, Modal } from '@/components/modal';
import { IconCalendar, IconChevronLeft, IconChevronRight, IconPlus, IconRefresh } from '@/components/icons';
import { useToast } from '@/components/toast';

export interface CalEvent {
  id: string; seriesId: string | null; isInstance: boolean; isRecurring: boolean; originalStartTime: string | null;
  summary: string; description: string; location: string; allDay: boolean;
  startDateTime: string | null; endDateTime: string | null; startDate: string | null; endDateInclusive: string | null;
  timeZone: string; recurrence: Recurrence | null; recurrenceComplex: boolean; etag: string; updated: string | null; htmlLink: string | null;
  readOnlyReason: null | 'calendar_read_only' | 'special_event_type' | 'has_attendees_or_meeting';
  feedbackLink: { feedbackId: string; title: string } | null;
}
interface Recurrence { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval: number; end: { type: 'never' } | { type: 'count'; count: number } | { type: 'until'; until: string } }
interface EventsResponse { binding: { calendarId: string; summary: string; timeZone: string; revision: number }; accessRole: string; fetchedAt: string; events: CalEvent[] }

const READ_ONLY_TEXT: Record<string, string> = {
  calendar_read_only: '你在 Google 對此日曆只有檢視權限。',
  special_event_type: '此活動是特殊類型（例如休假、專注時間），請在 Google 日曆編輯。',
  has_attendees_or_meeting: '此活動含與會者或會議資訊，為避免影響參與者，請在 Google 日曆編輯。',
};
const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日'];

type View = 'month' | 'week' | 'list';

function startOf(ev: CalEvent): DateTime {
  return ev.allDay ? DateTime.fromISO(ev.startDate!, { zone: DISPLAY_TZ }) : DateTime.fromISO(ev.startDateTime!).setZone(DISPLAY_TZ);
}
function endOf(ev: CalEvent): DateTime {
  return ev.allDay ? DateTime.fromISO(ev.endDateInclusive!, { zone: DISPLAY_TZ }).endOf('day') : DateTime.fromISO(ev.endDateTime!).setZone(DISPLAY_TZ);
}
function occursOn(ev: CalEvent, day: DateTime) {
  const s = startOf(ev);
  const e = endOf(ev);
  return s < day.endOf('day') && e > day.startOf('day');
}

export function CalendarPanel({ productId }: { productId: string }) {
  const { site } = useSite();
  const pathname = usePathname();
  const status = useResource<{ connected: boolean; needsReauth: boolean; missingScopes: string[]; provider: string }>('/integrations/google/calendar/status');
  const binding = useResource<{ calendarId: string; summary: string; timeZone: string; revision: number; myAccessRole: string | null } | null>(`/products/${productId}/calendar/binding`);
  const connectHref = `/api/v1/integrations/google/calendar/start?returnTo=${encodeURIComponent(pathname)}`;
  const flag = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('calendar') : null;
  const fake = site.providers.calendar === 'fake';

  if (status.loading || binding.loading) return <LoadingState label="讀取日曆設定…" />;
  if (status.error) return <ErrorState message={status.error.message} onRetry={status.reload} />;
  const st = status.data!;
  return (
    <div>
      {fake ? <div className="banner" style={{ marginBottom: 12 }}>開發模擬日曆：尚未設定 Google OAuth，活動只存在本機記憶體，不會寫入真實 Google 日曆。</div> : null}
      {flag && flag !== 'connected' ? <div className="banner banner-error" role="alert" style={{ marginBottom: 12 }}>{CONNECT_ERRORS[flag] ?? 'Google 日曆連結失敗，請重試。'}</div> : null}
      {!st.connected ? (
        <DeniedState title="尚未連結 Google 日曆" message="登入不會自動取得日曆權限。每位成員需以自己的 Google 帳號授權，且公司需在 Google 日曆分享產品日曆給你。" action={
          fake && site.testLogin
            ? <Button variant="primary" onClick={async () => { await api.post('/test-support/calendar/connect', { body: {} }); void status.reload(); }}><IconCalendar />連結模擬日曆（開發測試）</Button>
            : <a className="btn btn-primary" href={connectHref}><IconCalendar />連結 Google 日曆</a>
        } />
      ) : st.needsReauth ? (
        <DeniedState title="Google 日曆授權已失效" message="授權可能已被撤銷或過期，請重新連結。" action={<a className="btn btn-primary" href={connectHref}>重新連結</a>} />
      ) : !binding.data ? (
        <BindCalendar productId={productId} onBound={() => void binding.reload()} />
      ) : (
        <CalendarView productId={productId} bindingSummary={binding.data.summary} onDisconnect={async () => { await api.del('/integrations/google/calendar/connection'); void status.reload(); }} onUnbind={async () => { await api.del(`/products/${productId}/calendar/binding`, { ifMatch: binding.data!.revision }); void binding.reload(); }} />
      )}
    </div>
  );
}

const CONNECT_ERRORS: Record<string, string> = {
  wrong_account: '你授權的 Google 帳號與登入帳號不同，請改用本人帳號重新連結。',
  calendar_scopes_missing: '授權缺少日曆讀寫權限，請重新連結並勾選所有日曆權限。',
  calendar_reauth_required: 'Google 沒有提供長期授權，請重新連結並同意存取。',
  denied: '你取消了日曆授權。',
  state_error: '授權流程已過期，請重新開始。',
  not_configured: '伺服器尚未設定 Calendar 憑證加密金鑰。',
};

function BindCalendar({ productId, onBound }: { productId: string; onBound: () => void }) {
  const cals = useResource<{ id: string; summary: string; accessRole: string; bindable: boolean }[]>('/integrations/google/calendars');
  const [sel, setSel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (cals.loading) return <LoadingState label="讀取你的 Google 日曆…" />;
  if (cals.error) return <ErrorState message={cals.error.message} onRetry={cals.reload} />;
  const bindable = (cals.data ?? []).filter((c) => c.bindable);
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3>綁定產品共用日曆</h3>
      <p className="muted">每個產品綁定一個 Google 共用日曆。只能選擇你有編輯權限的日曆；平台不會修改 Google 的分享設定。</p>
      {bindable.length === 0 ? <EmptyState title="沒有可編輯的日曆">請公司管理員在 Google 日曆把產品日曆分享給你（可變更活動權限）。</EmptyState> : (
        <>
          <Field label="日曆">{(p) => (
            <select {...p} className="select" value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="">請選擇</option>
              {bindable.map((c) => <option key={c.id} value={c.id}>{c.summary}（{c.accessRole === 'owner' ? '擁有者' : '可編輯'}）</option>)}
            </select>
          )}</Field>
          {error ? <div className="field-error" role="alert">{error}</div> : null}
          <div><Button variant="primary" disabled={!sel} pending={pending} onClick={async () => {
            setPending(true);
            setError(null);
            try { await api.put(`/products/${productId}/calendar/binding`, { body: { calendarId: sel, expectedRevision: 0 } }); onBound(); } catch (e) { setError(errorMessage(e)); } finally { setPending(false); }
          }}>綁定</Button></div>
        </>
      )}
    </div>
  );
}

function windowFor(view: View, anchor: DateTime) {
  if (view === 'month') {
    const start = anchor.startOf('month').startOf('week');
    return { from: start, to: start.plus({ weeks: 6 }) };
  }
  if (view === 'week') {
    const start = anchor.startOf('week');
    return { from: start, to: start.plus({ weeks: 1 }) };
  }
  return { from: anchor.startOf('day'), to: anchor.startOf('day').plus({ days: 30 }) };
}

function CalendarView({ productId, bindingSummary, onDisconnect, onUnbind }: { productId: string; bindingSummary: string; onDisconnect: () => void; onUnbind: () => void }) {
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 'list' : 'month'));
  const [anchor, setAnchor] = useState(() => DateTime.now().setZone(DISPLAY_TZ));
  const [editing, setEditing] = useState<{ event: CalEvent | null; defaults?: Partial<CalEvent> } | null>(null);
  const [dayList, setDayList] = useState<DateTime | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const win = windowFor(view, anchor);
  const path = `/products/${productId}/calendar/events?from=${encodeURIComponent(win.from.toISO()!)}&to=${encodeURIComponent(win.to.toISO()!)}`;
  const res = useResource<EventsResponse>(path);
  useVisiblePolling(() => { void res.reload(); }, 60_000);
  const data = res.data;
  const canWrite = data ? data.accessRole === 'owner' || data.accessRole === 'writer' : false;
  const shift = (dir: 1 | -1) => setAnchor((a) => (view === 'month' ? a.plus({ months: dir }) : view === 'week' ? a.plus({ weeks: dir }) : a.plus({ days: 30 * dir })));
  const title = view === 'month' ? anchor.toFormat('yyyy 年 M 月') : `${win.from.toFormat('yyyy/MM/dd')} – ${win.to.minus({ days: 1 }).toFormat('MM/dd')}`;

  return (
    <div>
      <div className="cal-toolbar">
        <div className="tabs" role="tablist" aria-label="日曆檢視" style={{ border: 0 }}>
          {(['month', 'week', 'list'] as View[]).map((v) => (
            <button key={v} role="tab" type="button" className="tab" aria-selected={view === v} onClick={() => setView(v)}>{v === 'month' ? '月' : v === 'week' ? '週' : '活動清單'}</button>
          ))}
        </div>
        <Button size="sm" onClick={() => setAnchor(DateTime.now().setZone(DISPLAY_TZ))}>今天</Button>
        <Button size="sm" variant="ghost" icon aria-label="上一期" onClick={() => shift(-1)}><IconChevronLeft /></Button>
        <Button size="sm" variant="ghost" icon aria-label="下一期" onClick={() => shift(1)}><IconChevronRight /></Button>
        <span className="cal-title" aria-live="polite">{title}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="small muted">{res.refreshing ? <Spinner /> : null} {data ? `上次更新 ${DateTime.fromISO(data.fetchedAt).setZone(DISPLAY_TZ).toFormat('HH:mm:ss')}` : ''} · 時區 {DISPLAY_TZ}</span>
          <Button size="sm" variant="ghost" icon aria-label="重新整理" onClick={() => void res.reload()}><IconRefresh /></Button>
          <Button size="sm" variant="primary" disabled={!canWrite} title={canWrite ? undefined : '你只有檢視權限'} onClick={() => setEditing({ event: null })}><IconPlus />新增活動</Button>
        </span>
      </div>
      <div className="small muted" style={{ marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>日曆：{bindingSummary}{data ? `（你的權限：${data.accessRole === 'reader' ? '僅檢視' : data.accessRole === 'owner' ? '擁有者' : '可編輯'}）` : ''}</span>
        <Button size="sm" variant="ghost" onClick={onDisconnect}>解除我的 Google 連線</Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmUnbind(true)}>解除產品綁定</Button>
      </div>
      {res.loading ? <LoadingState label="讀取活動…" /> : res.error ? (
        res.error.code === 'CALENDAR_ACCESS_DENIED' ? <DeniedState title="沒有日曆權限" message={res.error.message} />
          : res.error.code === 'RATE_LIMITED' ? <ErrorState title="請求過多" message="Google 日曆暫時限制請求，請稍後重試。" onRetry={res.reload} />
            : <ErrorState message={res.error.message} onRetry={res.reload} />
      ) : !canWrite && data ? (
        <><div className="banner" style={{ marginBottom: 8 }}>你在 Google 對此日曆只有檢視權限，無法新增或修改活動。</div><Views /></>
      ) : <Views />}
      {editing ? (
        <EventModal productId={productId} bindingRevision={data?.binding.revision ?? 0} event={editing.event} defaults={editing.defaults} canWrite={canWrite}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void res.reload(); }} />
      ) : null}
      {dayList && data ? (
        <Modal title={dayList.toFormat('yyyy/MM/dd')} onClose={() => setDayList(null)}>
          <Agenda events={data.events.filter((e) => occursOn(e, dayList))} onOpen={(e) => { setDayList(null); setEditing({ event: e }); }} />
        </Modal>
      ) : null}
      {confirmUnbind ? (
        <ConfirmModal title="解除產品日曆綁定？" confirmLabel="解除綁定" danger onCancel={() => setConfirmUnbind(false)} onConfirm={() => { setConfirmUnbind(false); onUnbind(); }}>
          只解除平台與此 Google 日曆的關係與活動關聯，Google 上的活動不會被刪除，其他成員的授權也不受影響。
        </ConfirmModal>
      ) : null}
    </div>
  );

  function Views() {
    const events = data?.events ?? [];
    if (view === 'list') return events.length === 0 ? <EmptyState title="這段期間沒有活動" /> : <Agenda events={events} onOpen={(e) => setEditing({ event: e })} />;
    if (view === 'month') return <Month anchor={anchor} from={win.from} events={events} onOpen={(e) => setEditing({ event: e })} onMore={setDayList} onCreate={canWrite ? (d) => setEditing({ event: null, defaults: { allDay: false, startDateTime: d.set({ hour: 9 }).toISO(), endDateTime: d.set({ hour: 10 }).toISO() } }) : undefined} />;
    return <Week from={win.from} events={events} canWrite={canWrite} onOpen={(e) => setEditing({ event: e })} onReschedule={(e, start) => {
      const duration = endOf(e).diff(startOf(e));
      setEditing({ event: e, defaults: { startDateTime: start.toISO(), endDateTime: start.plus(duration).toISO() } });
    }} />;
  }
}

function Agenda({ events, onOpen }: { events: CalEvent[]; onOpen: (e: CalEvent) => void }) {
  const byDay = new Map<string, CalEvent[]>();
  for (const e of [...events].sort((a, b) => startOf(a).toMillis() - startOf(b).toMillis())) {
    const k = startOf(e).toISODate()!;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(e);
  }
  return (
    <div className="card card-pad">
      {[...byDay.entries()].map(([day, evs]) => (
        <div key={day} className="agenda-day">
          <h3>{DateTime.fromISO(day).toFormat('MM/dd')}（{WEEKDAY[DateTime.fromISO(day).weekday - 1]}）</h3>
          {evs.map((e) => (
            <button key={e.id} type="button" className="agenda-item" onClick={() => onOpen(e)}>
              <span className="agenda-time">{e.allDay ? '全天' : `${startOf(e).toFormat('HH:mm')}–${endOf(e).toFormat('HH:mm')}`}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{e.summary}</strong>{e.isRecurring ? <span className="chip" style={{ marginLeft: 6 }}>重複</span> : null}{e.readOnlyReason ? <span className="chip" style={{ marginLeft: 6 }}>唯讀</span> : null}
                {e.location ? <span className="small muted"> · {e.location}</span> : null}
                {e.feedbackLink ? <span className="small muted"> · 關聯：{e.feedbackLink.title}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function Month({ anchor, from, events, onOpen, onMore, onCreate }: { anchor: DateTime; from: DateTime; events: CalEvent[]; onOpen: (e: CalEvent) => void; onMore: (d: DateTime) => void; onCreate?: (d: DateTime) => void }) {
  const today = DateTime.now().setZone(DISPLAY_TZ).toISODate();
  const days = Array.from({ length: 42 }, (_, i) => from.plus({ days: i }));
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="month" role="grid" aria-label="月曆" style={{ minWidth: 640 }}>
        {WEEKDAY.map((w) => <div key={w} className="month-head" role="columnheader">週{w}</div>)}
        {days.map((d) => {
          const evs = events.filter((e) => occursOn(e, d)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || startOf(a).toMillis() - startOf(b).toMillis());
          return (
            <div key={d.toISODate()} className="month-cell" role="gridcell" data-other={d.month !== anchor.month || undefined} data-today={d.toISODate() === today || undefined}
              onDoubleClick={() => onCreate?.(d)}>
              <span className="day-num num" aria-label={d.toFormat('M 月 d 日')}>{d.day}</span>
              {evs.slice(0, 3).map((e) => (
                <button key={e.id} type="button" className="ev-chip" data-allday={e.allDay || undefined} data-readonly={Boolean(e.readOnlyReason) || undefined} onClick={() => onOpen(e)}
                  title={e.summary}>{e.allDay ? '' : `${startOf(e).toFormat('HH:mm')} `}{e.summary}</button>
              ))}
              {evs.length > 3 ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMore(d)}>更多 {evs.length - 3} 筆</button> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Week({ from, events, canWrite, onOpen, onReschedule }: { from: DateTime; events: CalEvent[]; canWrite: boolean; onOpen: (e: CalEvent) => void; onReschedule: (e: CalEvent, start: DateTime) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => from.plus({ days: i }));
  const [drag, setDrag] = useState<CalEvent | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const SLOT = 22; // px per 30 minutes
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="week" aria-label="週曆">
        <div className="week-head" />
        {days.map((d) => <div key={d.toISODate()} className="week-head">{d.toFormat('MM/dd')}（{WEEKDAY[d.weekday - 1]}）</div>)}
        <div className="week-head small">全天</div>
        {days.map((d) => (
          <div key={`ad-${d.toISODate()}`} className="week-allday">
            {events.filter((e) => e.allDay && occursOn(e, d)).map((e) => <button key={e.id} type="button" className="ev-chip" data-allday="true" onClick={() => onOpen(e)}>{e.summary}</button>)}
          </div>
        ))}
        <div>{Array.from({ length: 24 }, (_, h) => <div key={h} className="week-hour num">{String(h).padStart(2, '0')}:00</div> /* taste-skill-ignore: clock label */)}</div>
        {days.map((d) => (
          <div key={`c-${d.toISODate()}`} className="week-col">
            {Array.from({ length: 48 }, (_, s) => {
              const slotStart = d.startOf('day').plus({ minutes: s * 30 });
              const id = slotStart.toISO()!;
              return (
                <div key={s} className="week-slot" data-drop={over === id || undefined}
                  onDragOver={(e) => { if (!drag) return; e.preventDefault(); setOver(id); }}
                  onDrop={(e) => { e.preventDefault(); if (drag) onReschedule(drag, slotStart); setDrag(null); setOver(null); }} />
              );
            })}
            {events.filter((e) => !e.allDay && startOf(e).hasSame(d, 'day')).map((e) => {
              const s = startOf(e);
              const top = (s.hour * 60 + s.minute) / 30 * SLOT;
              const height = Math.max(SLOT, endOf(e).diff(s, 'minutes').minutes / 30 * SLOT);
              const movable = canWrite && !e.readOnlyReason;
              return (
                <button key={e.id} type="button" className="week-ev" style={{ top, height }} draggable={movable}
                  onDragStart={() => setDrag(e)} onDragEnd={() => { setDrag(null); setOver(null); }} onClick={() => onOpen(e)}
                  aria-label={`${e.summary}，${s.toFormat('HH:mm')}–${endOf(e).toFormat('HH:mm')}${movable ? '，可拖曳改期或開啟後修改時間' : ''}`}>
                  {s.toFormat('HH:mm')} {e.summary}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

interface FormState {
  summary: string; description: string; location: string; allDay: boolean;
  startDate: string; startTime: string; endDate: string; endTime: string; timeZone: string;
  repeat: 'none' | 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval: number; endType: 'never' | 'count' | 'until'; count: number; until: string;
  feedbackId: string | null;
}

function toForm(e: Partial<CalEvent> | null, tz = DISPLAY_TZ): FormState {
  const now = DateTime.now().setZone(tz).plus({ hours: 1 }).startOf('hour');
  const s = e?.startDateTime ? DateTime.fromISO(e.startDateTime, { setZone: true }).setZone(e.timeZone ?? tz) : now;
  const en = e?.endDateTime ? DateTime.fromISO(e.endDateTime, { setZone: true }).setZone(e.timeZone ?? tz) : s.plus({ hours: 1 });
  return {
    summary: e?.summary ?? '', description: e?.description ?? '', location: e?.location ?? '', allDay: e?.allDay ?? false,
    startDate: e?.allDay ? e.startDate! : s.toISODate()!, startTime: s.toFormat('HH:mm'),
    endDate: e?.allDay ? e.endDateInclusive! : en.toISODate()!, endTime: en.toFormat('HH:mm'),
    timeZone: e?.timeZone ?? tz,
    repeat: e?.recurrence?.freq ?? 'none', interval: e?.recurrence?.interval ?? 1,
    endType: e?.recurrence?.end.type ?? 'never',
    count: e?.recurrence?.end.type === 'count' ? e.recurrence.end.count : 5,
    until: e?.recurrence?.end.type === 'until' ? e.recurrence.end.until : s.plus({ months: 1 }).toISODate()!,
    feedbackId: e?.feedbackLink?.feedbackId ?? null,
  };
}

function timesBody(f: FormState) {
  if (f.allDay) return { allDay: true, startDate: f.startDate, endDateInclusive: f.endDate, timeZone: f.timeZone };
  const s = DateTime.fromISO(`${f.startDate}T${f.startTime}`, { zone: f.timeZone });
  const e = DateTime.fromISO(`${f.endDate}T${f.endTime}`, { zone: f.timeZone });
  return { allDay: false, startDateTime: s.toISO({ suppressMilliseconds: true }), endDateTime: e.toISO({ suppressMilliseconds: true }), timeZone: f.timeZone };
}

function recurrenceBody(f: FormState) {
  if (f.repeat === 'none') return null;
  return { freq: f.repeat, interval: f.interval, end: f.endType === 'count' ? { type: 'count', count: f.count } : f.endType === 'until' ? { type: 'until', until: f.until } : { type: 'never' } };
}

function EventModal({ productId, bindingRevision, event, defaults, canWrite, onClose, onSaved }: {
  productId: string; bindingRevision: number; event: CalEvent | null; defaults?: Partial<CalEvent>; canWrite: boolean; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const isNew = !event;
  const [scope, setScope] = useState<'single' | 'series' | null>(event && event.isInstance ? null : 'single');
  const [master, setMaster] = useState<CalEvent | null>(null);
  const [form, setForm] = useState<FormState>(() => toForm(event ? { ...event, ...defaults } : (defaults ?? null)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'error' | 'conflict' | 'unknown'; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const keyRef = useRef<string | null>(null);
  const readOnly = !canWrite || Boolean(event?.readOnlyReason);
  const set = (p: Partial<FormState>) => { keyRef.current = null; setForm((f) => ({ ...f, ...p })); };

  // whole-series edits load the master (its own start and ETag), never the clicked occurrence
  useEffect(() => {
    if (scope !== 'series' || !event?.seriesId) return;
    let alive = true;
    api.get<{ event: CalEvent }>(`/products/${productId}/calendar/events/${encodeURIComponent(event.seriesId)}`)
      .then((r) => { if (alive) { setMaster(r.data.event); setForm(toForm(r.data.event)); } })
      .catch((e) => { if (alive) setBanner({ kind: 'error', text: errorMessage(e) }); });
    return () => { alive = false; };
  }, [scope, event?.seriesId, productId]);

  const target = scope === 'series' ? master : event;
  const save = async () => {
    setErrors({});
    setBanner(null);
    if (!form.summary.trim()) { setErrors({ summary: '活動名稱必填' }); return; }
    keyRef.current ??= newKey();
    setPending(true);
    try {
      let r;
      if (isNew) {
        r = await api.post(`/products/${productId}/calendar/events`, { key: keyRef.current, body: {
          summary: form.summary, description: form.description, location: form.location, ...timesBody(form),
          recurrence: recurrenceBody(form), feedbackId: form.feedbackId, bindingRevision,
        } });
      } else {
        const base = target!;
        const orig = toForm(base);
        const body: Record<string, unknown> = { scope, expectedEtag: base.etag, bindingRevision };
        if (form.summary !== orig.summary) body.summary = form.summary;
        if (form.description !== orig.description) body.description = form.description;
        if (form.location !== orig.location) body.location = form.location;
        const timeKeys: (keyof FormState)[] = ['allDay', 'startDate', 'startTime', 'endDate', 'endTime', 'timeZone'];
        if (timeKeys.some((k) => form[k] !== orig[k])) Object.assign(body, timesBody(form));
        if (scope === 'series' && !base.recurrenceComplex && JSON.stringify(recurrenceBody(form)) !== JSON.stringify(recurrenceBody(orig))) body.recurrence = recurrenceBody(form);
        r = await api.patch(`/products/${productId}/calendar/events/${encodeURIComponent(base.id)}`, { key: keyRef.current, body });
        if (form.feedbackId !== (event?.feedbackLink?.feedbackId ?? null)) {
          const linkTarget = scope === 'series' ? base.id : event!.id;
          if (form.feedbackId) await api.put(`/products/${productId}/calendar/events/${encodeURIComponent(linkTarget)}/feedback-link`, { body: { feedbackId: form.feedbackId } });
          else await api.del(`/products/${productId}/calendar/events/${encodeURIComponent(linkTarget)}/feedback-link`);
        }
      }
      if (r.status === 202) {
        // unknown outcome: keep the form and the same key; retrying will verify first
        setBanner({ kind: 'unknown', text: 'Google 尚未確認這次儲存的結果。表單已保留，可按「再次核對並儲存」以相同操作重試（不會重複建立）。' });
        return;
      }
      keyRef.current = null;
      toast('success', isNew ? '已新增活動到 Google 日曆' : '已更新 Google 日曆活動');
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'EVENT_CONFLICT' || e.status === 409)) {
        keyRef.current = null;
        setBanner({ kind: 'conflict', text: '活動已在 Google 日曆或其他地方被更新。你的修改仍保留；請載入最新內容後再編輯。' });
      } else {
        setErrors(e instanceof ApiError ? e.body.fieldErrors : {});
        setBanner({ kind: 'error', text: errorMessage(e) });
      }
    } finally {
      setPending(false);
    }
  };
  const remove = async () => {
    const base = target!;
    keyRef.current ??= newKey();
    setPending(true);
    try {
      const r = await api.del(`/products/${productId}/calendar/events/${encodeURIComponent(base.id)}?scope=${scope}&bindingRevision=${bindingRevision}`, { key: keyRef.current, ifMatch: base.etag });
      if (r.status === 202) { setBanner({ kind: 'unknown', text: 'Google 尚未確認刪除結果，請稍後重試以核對。' }); setConfirmDelete(false); return; }
      toast('success', '已刪除活動');
      onSaved();
    } catch (e) {
      setBanner({ kind: e instanceof ApiError && e.status === 409 ? 'conflict' : 'error', text: errorMessage(e) });
      setConfirmDelete(false);
    } finally { setPending(false); }
  };

  const title = isNew ? '新增活動' : readOnly ? event!.summary : '編輯活動';
  if (!isNew && event!.isInstance && scope === null && !readOnly) {
    return (
      <Modal title="編輯重複活動" onClose={onClose} footer={<><Button onClick={onClose}>取消</Button></>}>
        <p>「{event!.summary}」是重複活動。要修改哪個範圍？</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button onClick={() => setScope('single')}>本次活動（只影響 {startOf(event!).toFormat('MM/dd HH:mm')} 這一次）</Button>
          <Button onClick={() => setScope('series')}>整個系列（修改系列設定，可能影響已改期或取消的例外）</Button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={title} onClose={onClose} footer={readOnly ? <>
      {event?.htmlLink ? <a className="btn" href={event.htmlLink} target="_blank" rel="noopener noreferrer">在 Google 開啟</a> : null}
      <Button onClick={onClose}>關閉</Button>
    </> : <>
      {!isNew ? <span className="spacer"><Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>刪除</Button></span> : null}
      {event?.htmlLink ? <a className="btn btn-ghost" href={event.htmlLink} target="_blank" rel="noopener noreferrer">在 Google 開啟</a> : null}
      <Button onClick={onClose}>取消</Button>
      <Button variant="primary" pending={pending} disabled={scope === 'series' && !master} onClick={save}>{banner?.kind === 'unknown' ? '再次核對並儲存' : '儲存'}</Button>
    </>}>
      {scope === 'series' ? <div className="banner banner-info small">正在編輯整個系列：表單顯示系列的原始起始時間，不是你點選的那一次。</div> : null}
      {readOnly && event?.readOnlyReason ? <div className="banner">{READ_ONLY_TEXT[event.readOnlyReason]}</div> : null}
      {banner ? <div className={`banner ${banner.kind === 'error' ? 'banner-error' : ''}`} role="alert">{banner.text}{banner.kind === 'conflict' ? <Button size="sm" onClick={onSaved}>載入最新內容</Button> : null}</div> : null}
      <Field label="活動名稱" required error={errors.summary}>{(p) => <input {...p} className="input" maxLength={200} value={form.summary} onChange={(e) => set({ summary: e.target.value })} disabled={readOnly} data-autofocus />}</Field>
      <Switch checked={form.allDay} onChange={(v) => set({ allDay: v })} label="全天活動" disabled={readOnly || (scope === 'series' && target?.recurrenceComplex)} />
      <div className="inline-fields">
        <Field label="開始日期" error={errors.startDate}>{(p) => <input {...p} className="input" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} disabled={readOnly} />}</Field>
        {!form.allDay ? <Field label="開始時間" error={errors.startDateTime}>{(p) => <input {...p} className="input" type="time" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} disabled={readOnly} />}</Field> : null}
        <Field label={form.allDay ? '結束日期（含當天）' : '結束日期'} error={errors.endDateInclusive}>{(p) => <input {...p} className="input" type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} disabled={readOnly} />}</Field>
        {!form.allDay ? <Field label="結束時間" error={errors.endDateTime}>{(p) => <input {...p} className="input" type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} disabled={readOnly} />}</Field> : null}
      </div>
      <Field label="時區" hint="IANA 時區，例如 Asia/Taipei；重複活動依此時區維持當地時間。" error={errors.timeZone}>{(p) => (
        <select {...p} className="select" value={form.timeZone} onChange={(e) => set({ timeZone: e.target.value })} disabled={readOnly}>
          {[...new Set([form.timeZone, 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Singapore', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'UTC'])].map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      )}</Field>
      <Field label="地點">{(p) => <input {...p} className="input" maxLength={500} value={form.location} onChange={(e) => set({ location: e.target.value })} disabled={readOnly} />}</Field>
      <Field label="說明">{(p) => <textarea {...p} className="textarea" maxLength={20000} value={form.description} onChange={(e) => set({ description: e.target.value })} disabled={readOnly} />}</Field>
      {isNew || scope === 'series' ? (
        target?.recurrenceComplex ? <div className="banner small">此系列使用平台不支援的重複規則，只能修改名稱、地點與說明；規則會原樣保留。</div> : (
          <div className="inline-fields">
            <Field label="重複">{(p) => (
              <select {...p} className="select" value={form.repeat} onChange={(e) => set({ repeat: e.target.value as FormState['repeat'] })} disabled={readOnly || (!isNew && scope === 'series' && false)}>
                {isNew ? <option value="none">不重複</option> : null}
                <option value="DAILY">每日</option><option value="WEEKLY">每週</option><option value="MONTHLY">每月</option>
              </select>
            )}</Field>
            {form.repeat !== 'none' ? <>
              <Field label="間隔">{(p) => <input {...p} className="input" type="number" min={1} max={99} value={form.interval} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
              <Field label="結束">{(p) => (
                <select {...p} className="select" value={form.endType} onChange={(e) => set({ endType: e.target.value as FormState['endType'] })}>
                  <option value="never">永不</option><option value="count">次數</option><option value="until">日期</option>
                </select>
              )}</Field>
              {form.endType === 'count' ? <Field label="次數">{(p) => <input {...p} className="input" type="number" min={1} max={730} value={form.count} onChange={(e) => set({ count: Math.max(1, Number(e.target.value) || 1) })} />}</Field> : null}
              {form.endType === 'until' ? <Field label="結束日期">{(p) => <input {...p} className="input" type="date" value={form.until} onChange={(e) => set({ until: e.target.value })} />}</Field> : null}
            </> : null}
          </div>
        )
      ) : event?.isInstance ? <p className="small muted">只修改這一次；要改重複規則請選擇「整個系列」。</p> : null}
      {!readOnly ? <FeedbackLinkPicker productId={productId} value={form.feedbackId} initialTitle={event?.feedbackLink?.title ?? null} onChange={(id) => set({ feedbackId: id })} /> : event?.feedbackLink ? <p>關聯 Feedback：{event.feedbackLink.title}</p> : null}
      {event?.updated ? <p className="small muted">Google 最後更新：{formatDateTime(event.updated)}</p> : null}
      {confirmDelete ? (
        <ConfirmModal title={scope === 'series' ? '刪除整個系列？' : '刪除這個活動？'} confirmLabel={scope === 'series' ? '刪除整個系列' : '刪除活動'} danger pending={pending} onCancel={() => setConfirmDelete(false)} onConfirm={remove}>
          {scope === 'series' ? '會從 Google 日曆刪除此系列的所有活動。' : event?.isInstance ? '只會刪除這一次，系列中的其他活動保留。' : '會從 Google 日曆刪除此活動。'}
        </ConfirmModal>
      ) : null}
    </Modal>
  );
}

function FeedbackLinkPicker({ productId, value, initialTitle, onChange }: { productId: string; value: string | null; initialTitle: string | null; onChange: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const res = useResource<{ id: string; title: string }[]>(dq.trim() ? `/products/${productId}/feedback?limit=10&q=${encodeURIComponent(dq.trim())}` : null);
  const [title, setTitle] = useState(initialTitle);
  const options = useMemo(() => res.data ?? [], [res.data]);
  return (
    <div className="field">
      <span className="field-label">關聯 Feedback（同產品）</span>
      {value ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="chip">{title ?? '已關聯'}</span><Button size="sm" variant="ghost" onClick={() => { onChange(null); setTitle(null); }}>取消關聯</Button></div>
      ) : (
        <>
          <label className="sr-only" htmlFor="fb-link-search">搜尋 Feedback</label>
          <input id="fb-link-search" className="input" placeholder="搜尋標題以關聯…" value={q} onChange={(e) => setQ(e.target.value)} />
          {options.length ? (
            <div className="menu card" style={{ padding: 4 }}>
              {options.map((o) => <button key={o.id} type="button" className="menu-item" onClick={() => { onChange(o.id); setTitle(o.title); setQ(''); }}>{o.title}</button>)}
            </div>
          ) : null}
        </>
      )}
      <span className="field-hint">只建立關聯，不會修改 Feedback 的 Schedule、狀態或標籤。</span>
    </div>
  );
}
