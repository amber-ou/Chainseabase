import type { Db } from '@/server/db';
import { AppError, assertRevision, invalid } from '@/server/errors';
import { getConfig } from '@/server/config';
import { hmacHex, sha256Hex } from '@/server/crypto';
import { enqueueJob } from '@/server/events';
import { iso } from '@/modules/shared/text';
import { getEmailProvider } from '@/server/adapters/email';
import type { SessionUser } from '@/server/session';

const INVITE_DAYS = 7;

export type InvitationStatus = 'pending' | 'sent' | 'send_failed' | 'accepted' | 'revoked' | 'expired';

interface InvitationRow {
  id: string; email: string; role: 'team' | 'tester'; expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null;
  revokedReason: 'manual' | 'superseded' | 'product_deleted' | null;
  createdAt: Date; sendState: string; sendAttempts: number; lastSentAt: Date | null; lastErrorCode: string | null; revision: number;
  createdBy: string; tokenHash: string | null;
}

function statusOf(r: InvitationRow): InvitationStatus {
  if (r.acceptedAt) return 'accepted';
  if (r.revokedAt) return 'revoked';
  if (r.expiresAt.getTime() < Date.now()) return 'expired';
  if (r.sendState === 'failed') return 'send_failed';
  return r.sendState === 'sent' ? 'sent' : 'pending';
}

async function dto(db: Db, r: InvitationRow) {
  const products = await db<{ id: string; name: string }[]>`
    select p.id, p.name from invitation_products ip join products p on p.id = ip.product_id where ip.invitation_id = ${r.id} order by p.created_at
  `;
  // never return the raw token or its hash
  return {
    id: r.id, email: r.email, role: r.role, status: statusOf(r), products: [...products],
    expiresAt: iso(r.expiresAt), acceptedAt: iso(r.acceptedAt), revokedAt: iso(r.revokedAt), revokedReason: r.revokedReason, createdAt: iso(r.createdAt),
    sendAttempts: r.sendAttempts, lastSentAt: iso(r.lastSentAt), lastErrorCode: r.lastErrorCode, revision: r.revision,
  };
}

export async function listInvitations(db: Db) {
  const rows = await db<InvitationRow[]>`select * from invitations order by created_at desc limit 200`;
  return Promise.all(rows.map((r) => dto(db, r)));
}

export async function createInvitation(tx: Db, actor: SessionUser, input: { email: string; role: 'team' | 'tester'; productIds: string[] }) {
  const email = input.email.trim().toLowerCase();
  const productIds = [...new Set(input.productIds)];
  if (input.role === 'tester' && productIds.length === 0) throw invalid('請選擇受邀產品。', { productIds: '測試成員至少需要一個產品' });
  if (input.role === 'team' && productIds.length > 0) throw invalid('團隊成員可使用所有產品，不需指定產品。', { productIds: '團隊邀請不指定產品' });
  if (productIds.length) {
    const found = await tx`select id from products where id in ${tx(productIds)}`;
    if (found.length !== productIds.length) throw invalid('產品不存在。', { productIds: '包含無效產品' });
  }
  const [member] = await tx<{ role: string }[]>`
    select role from users where lower(verified_email) = ${email} and membership_state = 'active' and role = 'team'
  `;
  if (member) throw invalid('此 Email 已是團隊成員。', { email: '已是團隊成員' });
  // older open invitations to the same address are superseded
  await tx`update invitations set revoked_at = now(), revoked_reason = 'superseded', revision = revision + 1 where email = ${email} and accepted_at is null and revoked_at is null`;
  const [inv] = await tx<InvitationRow[]>`
    insert into invitations (email, role, expires_at, created_by)
    values (${email}, ${input.role}, now() + ${`${INVITE_DAYS} days`}::interval, ${actor.id}) returning *
  `;
  for (const pid of productIds) await tx`insert into invitation_products (invitation_id, product_id) values (${inv.id}, ${pid})`;
  await enqueueJob(tx, 'invitation.send', { invitationId: inv.id });
  return dto(tx, inv);
}

async function lockOpen(tx: Db, id: string) {
  const [inv] = await tx<InvitationRow[]>`select * from invitations where id = ${id} for update`;
  if (!inv) throw new AppError('NOT_FOUND');
  return inv;
}

export async function resendInvitation(tx: Db, id: string, expectedRevision: number) {
  const inv = await lockOpen(tx, id);
  assertRevision(inv.revision, expectedRevision);
  if (inv.acceptedAt || inv.revokedAt) throw new AppError('INVITATION_INVALID', '此邀請已接受或撤銷，無法重寄。');
  if (inv.role === 'tester' && !(await validProductCount(tx, id))) throw new AppError('INVITATION_INVALID', '受邀的產品已不存在，無法重寄。請建立新的邀請。');
  // the previous link stops working immediately; the job issues a new token
  const [row] = await tx<InvitationRow[]>`
    update invitations set token_hash = null, send_state = 'pending', last_error_code = null,
      expires_at = now() + ${`${INVITE_DAYS} days`}::interval, revision = revision + 1
    where id = ${id} returning *
  `;
  await enqueueJob(tx, 'invitation.send', { invitationId: id });
  return dto(tx, row);
}

export async function revokeInvitation(tx: Db, id: string, expectedRevision: number) {
  const inv = await lockOpen(tx, id);
  assertRevision(inv.revision, expectedRevision);
  if (inv.acceptedAt) throw new AppError('INVITATION_INVALID', '此邀請已被接受。');
  const [row] = await tx<InvitationRow[]>`
    update invitations set revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, 'manual'), token_hash = null, revision = revision + 1 where id = ${id} returning *
  `;
  return dto(tx, row);
}

/** Token is derived from the job id with a server secret so retries send the same link; only its hash is stored. */
export function invitationTokenForJob(jobId: string): string {
  return Buffer.from(hmacHex(getConfig().sessionSecret, `invite:${jobId}`), 'hex').toString('base64url');
}

export async function sendInvitationJob(tx: Db, jobId: string, invitationId: string): Promise<'done' | 'retry' | 'failed'> {
  const [inv] = await tx<InvitationRow[]>`select * from invitations where id = ${invitationId} for update`;
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt.getTime() < Date.now()) return 'done';
  // checked again right before sending: a tester invitation whose products were all deleted is not sent
  if (inv.role === 'tester' && !(await validProductCount(tx, inv.id))) return 'done';
  const token = invitationTokenForJob(jobId);
  await tx`update invitations set token_hash = ${sha256Hex(token)}, send_attempts = send_attempts + 1 where id = ${invitationId}`;
  const cfg = getConfig();
  const origin = inv.role === 'team' ? cfg.adminOrigin : cfg.portalOrigin;
  const link = `${origin}/invite?token=${encodeURIComponent(token)}`;
  const roleLabel = inv.role === 'team' ? '團隊成員' : '測試成員';
  const result = await getEmailProvider().send({
    to: inv.email,
    subject: `Chainseabase ${roleLabel}邀請`,
    text: `你受邀成為 Chainseabase 的${roleLabel}。請使用此 Email（${inv.email}）的 Google 帳號登入後接受邀請：\n${link}\n\n連結 ${INVITE_DAYS} 天內有效，只能使用一次。`,
    html: `<p>你受邀成為 Chainseabase 的${roleLabel}。</p><p>請使用此 Email 的 Google 帳號登入後接受邀請：</p><p><a href="${link}">接受邀請</a></p><p>連結 ${INVITE_DAYS} 天內有效，只能使用一次。</p>`,
    idempotencyKey: `invite-${jobId}`,
  });
  if (result.ok) {
    await tx`update invitations set send_state = 'sent', last_sent_at = now(), last_error_code = null where id = ${invitationId}`;
    return 'done';
  }
  await tx`update invitations set send_state = ${result.retryable ? 'pending' : 'failed'}, last_error_code = ${result.code} where id = ${invitationId}`;
  return result.retryable ? 'retry' : 'failed';
}

/** Products an invitation still grants (a link to a deleted product cannot exist: deletion removes it). */
async function validProductCount(db: Db, invitationId: string) {
  const [{ n }] = await db<{ n: number }[]>`
    select count(*)::int as n from invitation_products ip join products p on p.id = ip.product_id where ip.invitation_id = ${invitationId}
  `;
  return n;
}

const EXPIRED_BY_DELETION = '邀請已失效：受邀的產品已被刪除。請聯絡團隊重新邀請。';

/** Why an invitation can no longer be accepted, or null. Accepted invitations are handled by the caller. */
async function invalidReason(db: Db, inv: InvitationRow): Promise<string | null> {
  if (inv.revokedAt) return inv.revokedReason === 'product_deleted' ? EXPIRED_BY_DELETION : '邀請已失效：此邀請已撤銷。';
  if (inv.expiresAt.getTime() < Date.now()) return '邀請已失效：此邀請已過期，請聯絡團隊重新寄送。';
  // never let a tester join with no product, whatever happened to the products since the e-mail was sent
  if (inv.role === 'tester' && !(await validProductCount(db, inv.id))) return EXPIRED_BY_DELETION;
  return null;
}

/**
 * Whether a link can still be accepted, without consuming it (shown as soon as the link opens).
 * Reveals nothing of the invitation itself: not the address, role or products.
 */
export async function inspectInvitation(db: Db, user: SessionUser, token: string): Promise<{ valid: boolean; alreadyAccepted: boolean; message: string | null }> {
  const [inv] = await db<InvitationRow[]>`select * from invitations where token_hash = ${sha256Hex(token)}`;
  if (!inv) return { valid: false, alreadyAccepted: false, message: '邀請已失效：邀請連結無效或已被取代。' };
  if (inv.acceptedAt) {
    const mine = (await db`select 1 from invitations where id = ${inv.id} and accepted_by = ${user.id}`).length > 0;
    return mine ? { valid: false, alreadyAccepted: true, message: '你已接受過此邀請。' } : { valid: false, alreadyAccepted: false, message: '邀請已失效：此邀請已被使用。' };
  }
  const reason = await invalidReason(db, inv);
  return reason ? { valid: false, alreadyAccepted: false, message: reason } : { valid: true, alreadyAccepted: false, message: null };
}

export async function acceptInvitation(tx: Db, user: SessionUser, token: string) {
  // lock order shared with product deletion: products first, then the invitation. The products are
  // locked FOR SHARE, so a deletion in progress finishes first (and its products are then gone) or
  // waits until this acceptance has committed (and then removes the access it granted, like any other).
  const [peek] = await tx<{ id: string }[]>`select id from invitations where token_hash = ${sha256Hex(token)}`;
  if (peek) {
    await tx`
      select p.id from products p join invitation_products ip on ip.product_id = p.id
      where ip.invitation_id = ${peek.id} order by p.id for share of p
    `;
  }
  const [inv] = await tx<InvitationRow[]>`select * from invitations where token_hash = ${sha256Hex(token)} for update`;
  if (!inv) throw new AppError('INVITATION_INVALID', '邀請已失效：邀請連結無效或已被取代。');
  if (inv.acceptedAt) {
    if (inv.acceptedAt && (await tx`select 1 from invitations where id = ${inv.id} and accepted_by = ${user.id}`).length) {
      return { invitationId: inv.id, role: inv.role, alreadyAccepted: true };
    }
    throw new AppError('INVITATION_INVALID', '邀請已失效：此邀請已被使用。');
  }
  const reason = await invalidReason(tx, inv);
  if (reason) throw new AppError('INVITATION_INVALID', reason);
  if (user.email.toLowerCase() !== inv.email) {
    // not consumed: the right account can still accept it
    throw new AppError('INVITATION_EMAIL_MISMATCH', `此邀請寄給 ${maskEmail(inv.email)}，請改用該 Email 的 Google 帳號登入。`);
  }
  const [u] = await tx<{ role: string; membershipState: string }[]>`select role, membership_state from users where id = ${user.id} for update`;
  if (inv.role === 'team') {
    await tx`update users set role = 'team', membership_state = 'active', revision = revision + 1 where id = ${user.id}`;
  } else {
    if (!(u.role === 'team' && u.membershipState === 'active')) {
      await tx`update users set role = 'tester', membership_state = 'active', revision = revision + 1 where id = ${user.id}`;
    }
    await tx`
      insert into product_access (user_id, product_id)
      select ${user.id}, product_id from invitation_products where invitation_id = ${inv.id}
      on conflict do nothing
    `;
  }
  await tx`update invitations set accepted_at = now(), accepted_by = ${user.id}, revision = revision + 1 where id = ${inv.id}`;
  return { invitationId: inv.id, role: inv.role, alreadyAccepted: false };
}

/**
 * Part of a product deletion, called with the product row already locked (FOR UPDATE). For every
 * invitation linked to the product: the link goes; an invitation not yet accepted that is left with
 * no product is revoked (reason product_deleted) and its queued e-mail jobs are cancelled. Accepted
 * invitations, team invitations and invitations that still have another product keep their state.
 * Invitations are locked in id order and counted after the lock, so two products deleted at once
 * cannot each leave the other's link behind and miss the revocation.
 */
export async function detachDeletedProduct(tx: Db, productId: string): Promise<{ revoked: string[] }> {
  const linked = await tx<InvitationRow[]>`
    select * from invitations where id in (select invitation_id from invitation_products where product_id = ${productId})
    order by id for update
  `;
  await tx`delete from invitation_products where product_id = ${productId}`;
  const revoked: string[] = [];
  for (const inv of linked) {
    // re-read after the lock: another deletion or an acceptance may have committed meanwhile
    const [cur] = await tx<InvitationRow[]>`select * from invitations where id = ${inv.id}`;
    if (!cur || cur.role !== 'tester' || cur.acceptedAt || cur.revokedAt) continue;
    if (await validProductCount(tx, cur.id)) continue;
    await tx`update invitations set revoked_at = now(), revoked_reason = 'product_deleted', revision = revision + 1 where id = ${cur.id}`;
    revoked.push(cur.id);
  }
  if (revoked.length) {
    // queued e-mails are not sent; a job already being processed re-checks the invitation before sending
    await tx`
      update outbox_jobs set state = 'cancelled', completed_at = now(), last_error = 'invitation_revoked_product_deleted'
      where job_type = 'invitation.send' and state = 'pending' and payload->>'invitationId' in ${tx(revoked)}
    `;
  }
  return { revoked };
}

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}
