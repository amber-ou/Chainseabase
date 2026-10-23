import type { Db } from '@/server/db';
import { AppError } from '@/server/errors';
import type { NotificationReason } from '@/server/events';
import { decodeCursor, encodeCursor, iso } from '@/modules/shared/text';
import { userRef } from '@/modules/shared/users';

interface Recipient { id: string; role: string; membershipState: string }

/**
 * Create notifications for one event. Recipients are re-checked against current
 * access; schedule content never reaches testers. Idempotent per (event, recipient).
 */
export async function fanoutNotificationEvent(tx: Db, eventId: string) {
  const [ev] = await tx<{ id: string; productId: string; actorId: string; payload: { feedbackId: string; intents: { recipientId: string; reason: NotificationReason }[] } }[]>`
    select id, product_id, actor_id, payload from domain_events where id = ${eventId}
  `;
  if (!ev) return;
  const feedbackId = ev.payload.feedbackId;
  const [fb] = await tx<{ visibility: string; deletedAt: Date | null }[]>`select visibility, deleted_at from feedback where id = ${feedbackId}`;
  if (!fb || fb.deletedAt) return;
  const merged = new Map<string, Set<NotificationReason>>();
  for (const i of ev.payload.intents ?? []) {
    if (i.recipientId === ev.actorId) continue;
    if (!merged.has(i.recipientId)) merged.set(i.recipientId, new Set());
    merged.get(i.recipientId)!.add(i.reason);
  }
  for (const [recipientId, reasons] of merged) {
    const [u] = await tx<Recipient[]>`select id, role, membership_state from users where id = ${recipientId}`;
    if (!u || u.membershipState !== 'active') continue;
    const allowed = [...reasons].filter((reason) => {
      if (u.role === 'team') return true;
      // testers: only general comments on public feedback of an invited product
      return reason === 'comment' && u.role === 'tester' && fb.visibility === 'public';
    });
    if (allowed.length === 0) continue;
    if (u.role === 'tester') {
      const access = await tx`select 1 from product_access where user_id = ${u.id} and product_id = ${ev.productId}`;
      if (access.length === 0) continue;
    }
    await tx`
      insert into notifications (event_id, recipient_id, product_id, feedback_id, actor_id, reason_codes)
      values (${ev.id}, ${u.id}, ${ev.productId}, ${feedbackId}, ${ev.actorId}, ${allowed}::text[])
      on conflict (event_id, recipient_id) do nothing
    `;
  }
}

function accessFilter(db: Db, user: { id: string; role: string }) {
  if (user.role === 'team') return db`true`;
  return db`(
    f.visibility = 'public' and not ('schedule_comment' = any(n.reason_codes))
    and exists (select 1 from product_access pa where pa.user_id = ${user.id} and pa.product_id = n.product_id)
  )`;
}

export async function listNotifications(
  db: Db, user: { id: string; role: string }, productId: string, opts: { unreadOnly?: boolean; cursor?: string; limit: number },
) {
  const c = decodeCursor(opts.cursor);
  const rows = await db<{
    id: string; reasonCodes: string[]; createdAt: Date; readAt: Date | null; feedbackId: string; title: string;
    actorId: string | null; displayName: string | null; avatarPath: string | null; googlePictureUrl: string | null; revision: number | null;
  }[]>`
    select n.id, n.reason_codes, n.created_at, n.read_at, n.feedback_id, f.title,
           u.id as actor_id, u.display_name, u.avatar_path, u.google_picture_url, u.revision
    from notifications n
    join feedback f on f.id = n.feedback_id and f.deleted_at is null
    left join users u on u.id = n.actor_id
    where n.recipient_id = ${user.id} and n.product_id = ${productId} and ${accessFilter(db, user)}
    ${opts.unreadOnly ? db`and n.read_at is null` : db``}
    ${c ? db`and (n.created_at, n.id) < (${c.createdAt}::timestamptz, ${c.id}::uuid)` : db``}
    order by n.created_at desc, n.id desc
    limit ${opts.limit + 1}
  `;
  const [{ unread }] = await db<{ unread: number }[]>`
    select count(*)::int as unread from notifications n join feedback f on f.id = n.feedback_id and f.deleted_at is null
    where n.recipient_id = ${user.id} and n.product_id = ${productId} and n.read_at is null and ${accessFilter(db, user)}
  `;
  const page = rows.slice(0, opts.limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      reasons: r.reasonCodes,
      feedback: { id: r.feedbackId, title: r.title },
      actor: r.actorId ? userRef({ id: r.actorId, displayName: r.displayName!, avatarPath: r.avatarPath, googlePictureUrl: r.googlePictureUrl, revision: r.revision ?? 1 }) : null,
      createdAt: iso(r.createdAt),
      readAt: iso(r.readAt),
    })),
    unreadCount: unread,
    nextCursor: rows.length > opts.limit ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null,
  };
}

export async function markRead(tx: Db, userId: string, productId: string, notificationId: string) {
  const rows = await tx`
    update notifications set read_at = coalesce(read_at, now())
    where id = ${notificationId} and recipient_id = ${userId} and product_id = ${productId} returning id
  `;
  if (rows.length === 0) throw new AppError('NOT_FOUND');
}

export async function markAllRead(tx: Db, userId: string, productId: string, before: string | null) {
  const rows = await tx`
    update notifications set read_at = now()
    where recipient_id = ${userId} and product_id = ${productId} and read_at is null
    ${before ? tx`and created_at <= ${before}::timestamptz` : tx``}
    returning id
  `;
  return { updated: rows.length };
}
