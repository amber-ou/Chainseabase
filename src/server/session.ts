import { getSql, type Db } from './db';
import { randomToken, sha256Hex } from './crypto';
import { originForSite, type Site } from './config';

export const SESSION_COOKIE = 'csb_session';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: 'team' | 'tester' | 'none';
  membershipState: 'active' | 'removed';
  avatarPath: string | null;
  googlePictureUrl: string | null;
  googleSub: string | null;
  revision: number;
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieAttributes(site: Site, maxAgeSeconds: number): string {
  const secure = originForSite(site).startsWith('https:') ? '; Secure' : '';
  // Host-only cookie: no Domain attribute, so admin and portal sessions stay separate.
  return `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function sessionCookie(site: Site, token: string): string {
  return `${SESSION_COOKIE}=${token}${cookieAttributes(site, SESSION_DAYS * 86400)}`;
}

export function clearSessionCookie(site: Site): string {
  return `${SESSION_COOKIE}=${cookieAttributes(site, 0)}`;
}

export async function createSession(db: Db, userId: string, site: Site): Promise<string> {
  const token = randomToken(32);
  await db`
    insert into sessions (id_hash, user_id, site, expires_at)
    values (${sha256Hex(token)}, ${userId}, ${site}, now() + ${`${SESSION_DAYS} days`}::interval)
  `;
  return token;
}

export async function revokeSession(db: Db, idHash: string) {
  await db`update sessions set revoked_at = now() where id_hash = ${idHash} and revoked_at is null`;
}

export async function revokeUserSessions(db: Db, userId: string, site?: Site) {
  if (site) {
    await db`update sessions set revoked_at = now() where user_id = ${userId} and site = ${site} and revoked_at is null`;
  } else {
    await db`update sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
  }
}

export async function loadSession(req: Request, site: Site): Promise<{ idHash: string; user: SessionUser } | null> {
  const token = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE];
  if (!token || token.length < 20 || token.length > 100) return null;
  const idHash = sha256Hex(token);
  const sql = getSql();
  const rows = await sql<SessionUser[]>`
    select u.id, u.verified_email as email, u.display_name, u.role, u.membership_state,
           u.avatar_path, u.google_picture_url, u.google_sub, u.revision
    from sessions s join users u on u.id = s.user_id
    where s.id_hash = ${idHash} and s.site = ${site} and s.revoked_at is null and s.expires_at > now()
  `;
  const user = rows[0];
  if (!user) return null;
  // Removed members keep their history but have no member rights.
  if (user.membershipState === 'removed') user.role = 'none';
  return { idHash, user };
}
