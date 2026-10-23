import { z } from 'zod';
import type { Ctx, Router } from '../http';
import { uuidParam } from '../http';
import { getConfig } from '../config';
import { getSql, withTx } from '../db';
import { AppError } from '../errors';
import { requireProduct, requireTeam } from '../authz';
import { safeEqual } from '../crypto';
import { getGoogleOAuth } from '../adapters/google-oauth';
import { processJobs, outboxStats } from '../jobs';
import { credentialStatus, disconnectCalendar } from '@/modules/calendar/credentials';
import {
  bindCalendar, calendarAccess, createEvent, deleteEvent, getBinding, getEvent, listEvents, listUserCalendars, setFeedbackLink,
  unbindCalendar, updateEvent, type MutationOutcome,
} from '@/modules/calendar/service';
import { WEEKDAYS } from '@/modules/calendar/recurrence';
import { text, zRevision, zUuid } from '@/modules/shared/text';

async function teamProduct(ctx: Ctx) {
  const user = requireTeam(ctx);
  const productId = uuidParam(ctx, 'p');
  await requireProduct(getSql(), productId);
  return { user, productId };
}

const zRecurrence = z.object({
  freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  interval: z.number().int().min(1).max(99).default(1),
  end: z.discriminatedUnion('type', [
    z.object({ type: z.literal('never') }).strict(),
    z.object({ type: z.literal('count'), count: z.number().int().min(1).max(730) }).strict(),
    z.object({ type: z.literal('until'), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  ]),
  byDay: z.array(z.enum(WEEKDAYS)).max(7).optional(),
}).strict();

const eventFields = {
  description: text(0, 20000, '說明').optional(),
  location: text(0, 500, '地點').optional(),
  allDay: z.boolean().optional(),
  startDateTime: z.string().max(40).optional(),
  endDateTime: z.string().max(40).optional(),
  startDate: z.string().max(10).optional(),
  endDateInclusive: z.string().max(10).optional(),
  timeZone: z.string().max(64).optional(),
};

function outcome(o: MutationOutcome) {
  if (o.state === 'unknown') {
    // Google may or may not have applied it: keep the form and the same key; never claim success
    return { status: 202, data: { state: 'unknown', mutationId: o.mutationId, message: 'Google 尚未確認結果，請稍後以相同操作重試或重新整理核對。' } };
  }
  return { data: { state: 'succeeded', mutationId: o.mutationId, event: o.event } };
}

export function registerCalendarRoutes(r: Router) {
  r.get('/integrations/google/calendar/status', ['admin'], async (ctx) => {
    const user = requireTeam(ctx);
    return { data: { ...(await credentialStatus(getSql(), user.id)), provider: getConfig().calendarProvider } };
  });

  r.delete('/integrations/google/calendar/connection', ['admin'], async (ctx) => {
    const user = requireTeam(ctx);
    const refresh = await withTx((tx) => disconnectCalendar(tx, user.id));
    // revoke the platform's own grant; company calendars and events stay untouched
    if (refresh) await getGoogleOAuth().revokeToken(refresh).catch(() => undefined);
    return { data: { connected: false } };
  });

  r.get('/integrations/google/calendars', ['admin'], async (ctx) => {
    const user = requireTeam(ctx);
    return { data: await listUserCalendars(user.id) };
  });

  r.get('/products/:p/calendar/binding', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const b = await getBinding(getSql(), productId);
    if (!b) return { data: null };
    const status = await credentialStatus(getSql(), user.id);
    let accessRole: string | null = null;
    if (status.connected && !status.needsReauth) {
      try { accessRole = await calendarAccess(user.id, b.calendarId); } catch { accessRole = null; }
    }
    return { data: { calendarId: b.calendarId, summary: b.calendarSummary, timeZone: b.calendarTimezone, revision: b.revision, myAccessRole: accessRole } };
  });

  r.put('/products/:p/calendar/binding', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const body = await ctx.body(z.object({ calendarId: z.string().min(1).max(300), expectedRevision: zRevision }).strict());
    const b = await bindCalendar(getSql(), user.id, productId, body.calendarId, body.expectedRevision);
    return { data: { calendarId: b.calendarId, summary: b.calendarSummary, timeZone: b.calendarTimezone, revision: b.revision } };
  });

  r.delete('/products/:p/calendar/binding', ['admin'], async (ctx) => {
    const { productId } = await teamProduct(ctx);
    const rev = ctx.ifMatchRevision();
    await withTx((tx) => unbindCalendar(tx, productId, rev));
    return { data: { unbound: true } };
  });

  r.get('/products/:p/calendar/events', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const q = ctx.query(z.object({ from: z.string().max(40), to: z.string().max(40) }));
    return { data: await listEvents(user.id, productId, q) };
  });

  r.get('/products/:p/calendar/events/:eventId', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    return { data: await getEvent(user.id, productId, ctx.params.eventId) };
  });

  r.post('/products/:p/calendar/events', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const key = ctx.idempotencyKey(true)!;
    const body = await ctx.body(z.object({
      summary: text(1, 200, '活動名稱'), ...eventFields, recurrence: zRecurrence.nullable().optional(),
      feedbackId: zUuid.nullable().optional(), bindingRevision: zRevision,
    }).strict());
    const o = await createEvent(user.id, productId, key, body);
    return o.state === 'succeeded' ? { status: 201, data: outcome(o).data } : outcome(o);
  });

  r.patch('/products/:p/calendar/events/:eventId', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const key = ctx.idempotencyKey(true)!;
    const body = await ctx.body(z.object({
      scope: z.enum(['single', 'series']), expectedEtag: z.string().min(1).max(200), bindingRevision: zRevision,
      summary: text(1, 200, '活動名稱').optional(), ...eventFields, recurrence: zRecurrence.nullable().optional(),
    }).strict());
    return outcome(await updateEvent(user.id, productId, ctx.params.eventId, key, body));
  });

  r.delete('/products/:p/calendar/events/:eventId', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const key = ctx.idempotencyKey(true)!;
    const etag = ctx.header('if-match');
    if (!etag) throw new AppError('REVISION_REQUIRED', '刪除活動需要 Google ETag。');
    const q = ctx.query(z.object({ scope: z.enum(['single', 'series']), bindingRevision: z.coerce.number().int().min(0) }));
    return outcome(await deleteEvent(user.id, productId, ctx.params.eventId, key, { scope: q.scope, etag, bindingRevision: q.bindingRevision }));
  });

  r.put('/products/:p/calendar/events/:eventId/feedback-link', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    const body = await ctx.body(z.object({ feedbackId: zUuid }).strict());
    return { data: await setFeedbackLink(user.id, productId, ctx.params.eventId, body.feedbackId) };
  });

  r.delete('/products/:p/calendar/events/:eventId/feedback-link', ['admin'], async (ctx) => {
    const { user, productId } = await teamProduct(ctx);
    return { data: await setFeedbackLink(user.id, productId, ctx.params.eventId, null) };
  });

  // ---------------- Jobs and health ----------------
  r.post('/jobs/run', ['admin'], async (ctx) => {
    const secret = getConfig().jobRunnerSecret;
    const auth = ctx.header('authorization') ?? '';
    if (!secret || !safeEqual(auth, `Bearer ${secret}`)) throw new AppError('NOT_FOUND');
    const results = await processJobs({ limit: 50 });
    return { data: { processed: results.length, results, stats: await outboxStats() } };
  });

  // Vercel Cron issues GET requests with the CRON_SECRET bearer token
  r.get('/jobs/run', ['admin'], async (ctx) => {
    const secret = getConfig().jobRunnerSecret;
    const auth = ctx.header('authorization') ?? '';
    if (!secret || !safeEqual(auth, `Bearer ${secret}`)) throw new AppError('NOT_FOUND');
    const results = await processJobs({ limit: 50 });
    return { data: { processed: results.length, stats: await outboxStats() } };
  });

  r.get('/health', ['admin', 'portal'], async () => {
    await getSql()`select 1`;
    return { data: { ok: true } };
  });
}
