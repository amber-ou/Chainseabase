import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Db } from '@/server/db';
import { getConfig, originForSite, type Site } from '@/server/config';
import { AppError } from '@/server/errors';
import { randomToken } from '@/server/crypto';
import { parseCookies } from '@/server/session';
import type { IdentityClaims } from '@/server/adapters/google-oauth';

export const OAUTH_COOKIE = 'csb_oauth';

export interface OAuthTransient {
  purpose: 'login' | 'calendar';
  site: Site;
  state: string;
  verifier: string;
  nonce: string;
  returnTo: string;
}

function secretKey() {
  const s = getConfig().sessionSecret;
  if (!s) throw new AppError('NOT_CONFIGURED', '缺少 AUTH_SESSION_SECRET。');
  return new TextEncoder().encode(s);
}

export function pkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function newTransient(purpose: 'login' | 'calendar', site: Site, returnTo: string): OAuthTransient {
  return { purpose, site, state: randomToken(24), verifier: randomToken(48), nonce: randomToken(24), returnTo };
}

export async function transientCookie(t: OAuthTransient): Promise<string> {
  const jwt = await new SignJWT({ ...t }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(secretKey());
  const secure = originForSite(t.site).startsWith('https:') ? '; Secure' : '';
  return `${OAUTH_COOKIE}=${jwt}; Path=/api/v1; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;
}

export function clearTransientCookie(site: Site): string {
  const secure = originForSite(site).startsWith('https:') ? '; Secure' : '';
  return `${OAUTH_COOKIE}=; Path=/api/v1; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function readTransient(req: Request, purpose: 'login' | 'calendar', site: Site, state: string | null): Promise<OAuthTransient> {
  const raw = parseCookies(req.headers.get('cookie'))[OAUTH_COOKIE];
  if (!raw || !state) throw new AppError('AUTH_REQUIRED', '登入流程已過期，請重新開始。');
  let payload: OAuthTransient;
  try {
    payload = (await jwtVerify(raw, secretKey(), { algorithms: ['HS256'] })).payload as unknown as OAuthTransient;
  } catch {
    throw new AppError('AUTH_REQUIRED', '登入流程已過期，請重新開始。');
  }
  if (payload.purpose !== purpose || payload.site !== site || payload.state !== state) {
    throw new AppError('AUTH_REQUIRED', '登入流程驗證失敗（state），請重新開始。');
  }
  return payload;
}

/** Only same-site relative paths are accepted as return targets. */
export function safeReturnTo(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.includes('\n') || raw.length > 500) return fallback;
  try {
    const u = new URL(raw, 'http://local.invalid');
    if (u.origin !== 'http://local.invalid') return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

/**
 * Upsert the account for a verified Google identity. Login never grants team
 * rights except the deployment's bootstrap email, consumed exactly once.
 */
export async function upsertGoogleUser(tx: Db, claims: IdentityClaims): Promise<string> {
  if (!claims.emailVerified || !claims.email) throw new AppError('AUTH_REQUIRED', 'Google 帳號的 Email 尚未驗證，無法登入。');
  const name = claims.name.slice(0, 100) || claims.email;
  const [existing] = await tx<{ id: string }[]>`select id from users where google_sub = ${claims.sub} for update`;
  let userId: string;
  if (existing) {
    await tx`
      update users set verified_email = ${claims.email}, google_picture_url = ${claims.picture}, updated_at = now()
      where id = ${existing.id}
    `;
    userId = existing.id;
  } else {
    const [u] = await tx<{ id: string }[]>`
      insert into users (google_sub, verified_email, display_name, google_picture_url, role)
      values (${claims.sub}, ${claims.email}, ${name}, ${claims.picture}, 'none') returning id
    `;
    userId = u.id;
  }
  const [grant] = await tx<{ email: string }[]>`
    select email from bootstrap_team_grants where email = ${claims.email} and consumed_at is null for update
  `;
  if (grant) {
    await tx`update users set role = 'team', membership_state = 'active', revision = revision + 1 where id = ${userId}`;
    await tx`update bootstrap_team_grants set consumed_at = now(), consumed_by = ${userId} where email = ${grant.email}`;
  }
  return userId;
}
