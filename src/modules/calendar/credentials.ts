import type { Db } from '@/server/db';
import { AppError } from '@/server/errors';
import { decryptSecret, encryptSecret, isEncryptionConfigured } from '@/server/crypto';
import { CALENDAR_SCOPES, getGoogleOAuth, OAuthGrantError, type TokenSet } from '@/server/adapters/google-oauth';

interface CredRow { userId: string; providerSub: string; encryptedRefreshToken: string | null; grantedScopes: string[]; needsReauth: boolean; revokedAt: Date | null }

/** Short-lived access tokens stay in server memory only (never sent to the browser or logged). */
const accessCache = new Map<string, { token: string; expiresAt: number }>();

export function clearAccessCache(userId?: string) {
  if (userId) accessCache.delete(userId);
  else accessCache.clear();
}

export function missingScopes(granted: string[]): string[] {
  return CALENDAR_SCOPES.filter((s) => !granted.includes(s));
}

export async function credentialStatus(db: Db, userId: string) {
  const [c] = await db<CredRow[]>`select * from google_credentials where user_id = ${userId}`;
  if (!c || c.revokedAt || !c.encryptedRefreshToken) return { connected: false, needsReauth: false, grantedScopes: [] as string[], missingScopes: CALENDAR_SCOPES };
  return { connected: true, needsReauth: c.needsReauth, grantedScopes: c.grantedScopes, missingScopes: missingScopes(c.grantedScopes) };
}

/**
 * Save tokens from the incremental Calendar consent. A response without a new
 * refresh token keeps the existing valid one (never overwritten with null);
 * an incomplete grant never replaces a working credential.
 */
export async function saveCalendarGrant(tx: Db, userId: string, providerSub: string, tokens: TokenSet) {
  if (!isEncryptionConfigured()) throw new AppError('NOT_CONFIGURED', 'Calendar 憑證加密金鑰（TOKEN_ENCRYPTION_KEY）尚未設定。');
  const [existing] = await tx<CredRow[]>`select * from google_credentials where user_id = ${userId} for update`;
  const missing = missingScopes(tokens.scope);
  if (missing.length) {
    throw new AppError('CALENDAR_SCOPES_MISSING', '授權未包含日曆讀寫所需權限，請重新連結並勾選所有日曆權限。', { details: { missingScopes: missing } });
  }
  if (!tokens.refreshToken) {
    if (existing?.encryptedRefreshToken && !existing.revokedAt) {
      await tx`
        update google_credentials set granted_scopes = ${tokens.scope}::text[], needs_reauth = false, updated_at = now()
        where user_id = ${userId}
      `;
      accessCache.set(userId, { token: tokens.accessToken, expiresAt: Date.now() + (tokens.expiresIn - 60) * 1000 });
      return;
    }
    throw new AppError('CALENDAR_REAUTH_REQUIRED', 'Google 沒有提供長期授權，請重新連結並同意存取。');
  }
  const { ciphertext, keyVersion } = encryptSecret(tokens.refreshToken);
  await tx`
    insert into google_credentials (user_id, provider_sub, encrypted_refresh_token, key_version, granted_scopes)
    values (${userId}, ${providerSub}, ${ciphertext}, ${keyVersion}, ${tokens.scope}::text[])
    on conflict (user_id) do update set provider_sub = excluded.provider_sub, encrypted_refresh_token = excluded.encrypted_refresh_token,
      key_version = excluded.key_version, granted_scopes = excluded.granted_scopes, needs_reauth = false, revoked_at = null, updated_at = now()
  `;
  accessCache.set(userId, { token: tokens.accessToken, expiresAt: Date.now() + (tokens.expiresIn - 60) * 1000 });
}

export async function getAccessToken(db: Db, userId: string): Promise<string> {
  const cached = accessCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const [c] = await db<CredRow[]>`select * from google_credentials where user_id = ${userId}`;
  if (!c || c.revokedAt || !c.encryptedRefreshToken) throw new AppError('CALENDAR_NOT_CONNECTED', '尚未連結 Google 日曆。');
  if (c.needsReauth) throw new AppError('CALENDAR_REAUTH_REQUIRED', 'Google 日曆授權已失效，請重新連結。');
  try {
    const r = await getGoogleOAuth().refreshAccessToken(decryptSecret(c.encryptedRefreshToken));
    accessCache.set(userId, { token: r.accessToken, expiresAt: Date.now() + (r.expiresIn - 60) * 1000 });
    return r.accessToken;
  } catch (e) {
    if (e instanceof OAuthGrantError && e.invalidGrant) {
      // revoked or expired: stop retrying until the user reconnects
      await db`update google_credentials set needs_reauth = true, updated_at = now() where user_id = ${userId}`;
      throw new AppError('CALENDAR_REAUTH_REQUIRED', 'Google 日曆授權已失效，請重新連結。');
    }
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Google 授權服務暫時無法使用。', { retryable: true });
  }
}

/** Invalidate the cached token after Google rejects it (401). */
export function dropAccessToken(userId: string) {
  accessCache.delete(userId);
}

export async function disconnectCalendar(tx: Db, userId: string): Promise<string | null> {
  const [c] = await tx<CredRow[]>`delete from google_credentials where user_id = ${userId} returning *`;
  accessCache.delete(userId);
  if (!c?.encryptedRefreshToken) return null;
  try {
    return decryptSecret(c.encryptedRefreshToken);
  } catch {
    return null;
  }
}
