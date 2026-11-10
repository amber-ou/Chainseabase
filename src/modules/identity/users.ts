import type { Db } from '@/server/db';
import { AppError, assertRevision, invalid } from '@/server/errors';
import { revokeUserSessions, type SessionUser } from '@/server/session';
import { avatarUrlFor } from '@/modules/shared/users';
import { iso } from '@/modules/shared/text';
import { syncPersonalPlacementsForSubject } from '@/modules/personal/cleanup';

/** Serializes every change that could reduce the number of team members. */
const TEAM_LOCK_KEY = 7_340_001;

export async function meDto(db: Db, user: SessionUser) {
  const products = user.role === 'team'
    ? await db<{ id: string; name: string; slug: string }[]>`select id, name, slug from products order by created_at, id`
    : user.role === 'tester'
      ? await db<{ id: string; name: string; slug: string }[]>`
          select p.id, p.name, p.slug from product_access pa join products p on p.id = pa.product_id
          where pa.user_id = ${user.id} order by p.created_at, p.id
        `
      : [];
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: avatarUrlFor(user),
    hasCustomAvatar: Boolean(user.avatarPath),
    role: user.role,
    revision: user.revision,
    interactiveProducts: [...products],
  };
}

export async function updateMe(tx: Db, user: SessionUser, input: { displayName: string; expectedRevision: number }) {
  const [u] = await tx<{ revision: number }[]>`select revision from users where id = ${user.id} for update`;
  assertRevision(u.revision, input.expectedRevision);
  await tx`update users set display_name = ${input.displayName}, revision = revision + 1, updated_at = now() where id = ${user.id}`;
}

export async function listProductUsers(db: Db, productId: string) {
  const rows = await db<{
    id: string; displayName: string; email: string; role: string; avatarPath: string | null; googlePictureUrl: string | null;
    revision: number; feedbackCount: number; createdAt: Date;
  }[]>`
    select u.id, u.display_name, u.verified_email as email, u.role, u.avatar_path, u.google_picture_url, u.revision, u.created_at,
      (select count(*)::int from feedback f where f.product_id = ${productId} and f.author_id = u.id and f.deleted_at is null) as feedback_count
    from users u
    where u.membership_state = 'active'
      and (u.role = 'team' or (u.role = 'tester' and exists (select 1 from product_access pa where pa.user_id = u.id and pa.product_id = ${productId})))
    order by (u.role = 'team') desc, u.display_name, u.id
  `;
  const tags = await db<{ userId: string; id: string; name: string }[]>`
    select upt.user_id, p.id, p.name from user_person_tags upt join person_tags p on p.id = upt.person_tag_id
    where upt.product_id = ${productId} order by p.position, p.name
  `;
  const access = await db<{ userId: string; productId: string; name: string }[]>`
    select pa.user_id, pa.product_id, p.name from product_access pa join products p on p.id = pa.product_id
  `;
  return rows.map((r) => ({
    id: r.id, displayName: r.displayName, email: r.email, role: r.role, avatarUrl: avatarUrlFor(r), revision: r.revision,
    feedbackCount: r.feedbackCount, joinedAt: iso(r.createdAt),
    personTags: tags.filter((t) => t.userId === r.id).map((t) => ({ id: t.id, name: t.name })),
    testerProducts: r.role === 'tester' ? access.filter((a) => a.userId === r.id).map((a) => ({ id: a.productId, name: a.name })) : [],
  }));
}

export async function getProductUser(db: Db, productId: string, userId: string) {
  const all = await listProductUsers(db, productId);
  const u = all.find((x) => x.id === userId);
  if (!u) throw new AppError('NOT_FOUND');
  const [{ commentCount }] = await db<{ commentCount: number }[]>`
    select count(*)::int as comment_count from comments c join feedback f on f.id = c.feedback_id
    where c.product_id = ${productId} and c.author_id = ${userId} and c.deleted_at is null and f.deleted_at is null
  `;
  return { ...u, commentCount };
}

export async function listUserComments(db: Db, productId: string, userId: string, limit: number) {
  const rows = await db<{ id: string; feedbackId: string; title: string; stream: string; kind: string; body: string; createdAt: Date }[]>`
    select c.id, c.feedback_id, f.title, c.stream, c.kind, c.body, c.created_at
    from comments c join feedback f on f.id = c.feedback_id
    where c.product_id = ${productId} and c.author_id = ${userId} and c.deleted_at is null and f.deleted_at is null
    order by c.created_at desc, c.id desc limit ${limit}
  `;
  return rows.map((r) => ({ id: r.id, feedback: { id: r.feedbackId, title: r.title }, stream: r.stream, kind: r.kind, body: r.body, createdAt: iso(r.createdAt) }));
}

async function lockTeam(tx: Db) {
  await tx`select pg_advisory_xact_lock(${TEAM_LOCK_KEY})`;
}

async function otherActiveTeamCount(tx: Db, userId: string): Promise<number> {
  const [{ count }] = await tx<{ count: number }[]>`
    select count(*)::int as count from users where role = 'team' and membership_state = 'active' and id <> ${userId}
  `;
  return count;
}

/** Losing team rights: person tags, admin sessions and Calendar credentials go away immediately. */
async function stripTeamRights(tx: Db, userId: string) {
  await tx`delete from user_person_tags where user_id = ${userId}`;
  await revokeUserSessions(tx, userId, 'admin');
  await tx`delete from google_credentials where user_id = ${userId}`;
  await syncPersonalPlacementsForSubject(tx, userId);
}

export async function changeRole(
  tx: Db, actor: SessionUser, userId: string, input: { role: 'team' | 'tester'; testerProductIds?: string[]; expectedRevision: number },
) {
  await lockTeam(tx);
  const [u] = await tx<{ role: string; membershipState: string; revision: number }[]>`
    select role, membership_state, revision from users where id = ${userId} for update
  `;
  if (!u || u.membershipState !== 'active' || u.role === 'none') throw new AppError('NOT_FOUND');
  assertRevision(u.revision, input.expectedRevision);
  if (input.role === 'tester') {
    const productIds = [...new Set(input.testerProductIds ?? [])];
    if (productIds.length) {
      const found = await tx`select id from products where id in ${tx(productIds)}`;
      if (found.length !== productIds.length) throw invalid('產品不存在。', { testerProductIds: '包含無效產品' });
    }
    if (u.role === 'team' && (await otherActiveTeamCount(tx, userId)) === 0) throw new AppError('LAST_TEAM_MEMBER');
    await tx`update users set role = 'tester', revision = revision + 1, updated_at = now() where id = ${userId}`;
    // no automatic access to all products: exactly the listed ones
    await tx`delete from product_access where user_id = ${userId}`;
    for (const pid of productIds) await tx`insert into product_access (user_id, product_id) values (${userId}, ${pid})`;
    if (u.role === 'team') await stripTeamRights(tx, userId);
  } else {
    if (input.testerProductIds?.length) throw invalid('團隊成員不需指定產品。', { testerProductIds: '團隊可使用所有產品' });
    await tx`update users set role = 'team', revision = revision + 1, updated_at = now() where id = ${userId}`;
    await tx`delete from product_access where user_id = ${userId}`;
    // a tester's portal session keeps working; admin requires a fresh admin login
  }
  void actor;
}

export async function removeMembership(tx: Db, userId: string, expectedRevision: number) {
  await lockTeam(tx);
  const [u] = await tx<{ role: string; membershipState: string; revision: number }[]>`
    select role, membership_state, revision from users where id = ${userId} for update
  `;
  if (!u || u.membershipState !== 'active' || u.role === 'none') throw new AppError('NOT_FOUND');
  assertRevision(u.revision, expectedRevision);
  if (u.role === 'team' && (await otherActiveTeamCount(tx, userId)) === 0) throw new AppError('LAST_TEAM_MEMBER');
  // history (authored feedback/comments) keeps the author identity
  await tx`update users set membership_state = 'removed', role = 'none', revision = revision + 1, updated_at = now() where id = ${userId}`;
  await tx`delete from product_access where user_id = ${userId}`;
  await stripTeamRights(tx, userId);
  await revokeUserSessions(tx, userId);
}
