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
    expiresAt: iso(r.expiresAt), acceptedAt: iso(r.acceptedAt), revokedAt: iso(r.revokedAt), createdAt: iso(r.createdAt),
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
  await tx`update invitations set revoked_at = now(), revision = revision + 1 where email = ${email} and accepted_at is null and revoked_at is null`;
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
    update invitations set revoked_at = coalesce(revoked_at, now()), token_hash = null, revision = revision + 1 where id = ${id} returning *
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

export async function acceptInvitation(tx: Db, user: SessionUser, token: string) {
  const [inv] = await tx<InvitationRow[]>`select * from invitations where token_hash = ${sha256Hex(token)} for update`;
  if (!inv) throw new AppError('INVITATION_INVALID', '邀請連結無效或已失效。');
  if (inv.acceptedAt) {
    if (inv.acceptedAt && (await tx`select 1 from invitations where id = ${inv.id} and accepted_by = ${user.id}`).length) {
      return { invitationId: inv.id, role: inv.role, alreadyAccepted: true };
    }
    throw new AppError('INVITATION_INVALID', '此邀請已被使用。');
  }
  if (inv.revokedAt) throw new AppError('INVITATION_INVALID', '此邀請已撤銷。');
  if (inv.expiresAt.getTime() < Date.now()) throw new AppError('INVITATION_INVALID', '此邀請已過期，請聯絡團隊重新寄送。');
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

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}
