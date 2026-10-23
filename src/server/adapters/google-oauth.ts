import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getConfig } from '../config';
import { AppError } from '../errors';

export const LOGIN_SCOPES = ['openid', 'email', 'profile'];
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

export interface AuthorizationParams {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce: string;
  scopes: string[];
  loginHint?: string;
  offline?: boolean;
  forceConsent?: boolean;
}

export interface TokenSet {
  idToken: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string[];
}

export interface IdentityClaims { sub: string; email: string; emailVerified: boolean; name: string; picture: string | null }

export class OAuthGrantError extends Error {
  constructor(public readonly invalidGrant: boolean, message: string) { super(message); }
}

export interface GoogleOAuthClient {
  readonly mode: 'real' | 'fake';
  authorizationUrl(p: AuthorizationParams): string;
  exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>;
  verifyIdToken(idToken: string, nonce: string): Promise<IdentityClaims>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number; scope: string[] }>;
  revokeToken(token: string): Promise<void>;
}

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export class RealGoogleOAuthClient implements GoogleOAuthClient {
  readonly mode = 'real' as const;
  private jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  constructor(private clientId: string, private clientSecret: string) {}

  authorizationUrl(p: AuthorizationParams): string {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', this.clientId);
    u.searchParams.set('redirect_uri', p.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', p.scopes.join(' '));
    u.searchParams.set('state', p.state);
    u.searchParams.set('nonce', p.nonce);
    u.searchParams.set('code_challenge', p.codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    if (p.loginHint) u.searchParams.set('login_hint', p.loginHint);
    if (p.offline) {
      u.searchParams.set('access_type', 'offline');
      u.searchParams.set('include_granted_scopes', 'true');
    }
    u.searchParams.set('prompt', p.forceConsent ? 'consent select_account' : 'select_account');
    return u.toString();
  }

  private async token(body: Record<string, string>) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...body }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new OAuthGrantError(json.error === 'invalid_grant', `google_token_${res.status}_${String(json.error ?? '')}`);
    }
    return json;
  }

  async exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet> {
    const j = await this.token({ grant_type: 'authorization_code', code: p.code, code_verifier: p.codeVerifier, redirect_uri: p.redirectUri });
    return {
      idToken: (j.id_token as string) ?? null,
      accessToken: j.access_token as string,
      refreshToken: (j.refresh_token as string) ?? null,
      expiresIn: Number(j.expires_in ?? 3600),
      scope: String(j.scope ?? '').split(' ').filter(Boolean),
    };
  }

  async verifyIdToken(idToken: string, nonce: string): Promise<IdentityClaims> {
    const { payload } = await jwtVerify(idToken, this.jwks, { issuer: GOOGLE_ISSUERS, audience: this.clientId });
    if (payload.nonce !== nonce) throw new AppError('AUTH_REQUIRED', '登入驗證失敗（nonce）。');
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? '').toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: String(payload.name ?? payload.email ?? 'Google 使用者'),
      picture: typeof payload.picture === 'string' ? payload.picture : null,
    };
  }

  async refreshAccessToken(refreshToken: string) {
    const j = await this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
    return { accessToken: j.access_token as string, expiresIn: Number(j.expires_in ?? 3600), scope: String(j.scope ?? '').split(' ').filter(Boolean) };
  }

  async revokeToken(token: string) {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  }
}

/**
 * Test double. Codes are registered by tests: code -> identity + tokens.
 * Never used when GOOGLE_CLIENT_ID/SECRET are configured, never in production.
 */
export class FakeGoogleOAuthClient implements GoogleOAuthClient {
  readonly mode = 'fake' as const;
  codes = new Map<string, { claims: IdentityClaims; scope: string[]; refreshToken: string | null; nonce?: string }>();
  refreshTokens = new Map<string, { accessToken: string; scope: string[]; revoked?: boolean }>();
  lastAuthorization: AuthorizationParams | null = null;

  authorizationUrl(p: AuthorizationParams): string {
    this.lastAuthorization = p;
    const u = new URL('https://fake-google.invalid/auth');
    u.searchParams.set('state', p.state);
    u.searchParams.set('redirect_uri', p.redirectUri);
    return u.toString();
  }
  async exchangeCode(p: { code: string }): Promise<TokenSet> {
    const c = this.codes.get(p.code);
    if (!c) throw new OAuthGrantError(true, 'fake_invalid_code');
    this.codes.delete(p.code);
    const accessToken = `fake-access-${c.claims.sub}-${Math.random().toString(36).slice(2)}`;
    if (c.refreshToken) this.refreshTokens.set(c.refreshToken, { accessToken, scope: c.scope });
    return { idToken: `fake-id:${p.code}:${JSON.stringify(c.claims)}`, accessToken, refreshToken: c.refreshToken, expiresIn: 3600, scope: c.scope };
  }
  async verifyIdToken(idToken: string): Promise<IdentityClaims> {
    const json = idToken.split(':').slice(2).join(':');
    return JSON.parse(json) as IdentityClaims;
  }
  async refreshAccessToken(refreshToken: string) {
    const r = this.refreshTokens.get(refreshToken);
    if (!r || r.revoked) throw new OAuthGrantError(true, 'fake_invalid_grant');
    return { accessToken: r.accessToken, expiresIn: 3600, scope: r.scope };
  }
  async revokeToken(token: string) {
    const r = this.refreshTokens.get(token);
    if (r) r.revoked = true;
  }
}

const g = globalThis as unknown as { __csbGoogleOAuth?: GoogleOAuthClient };

export function getGoogleOAuth(): GoogleOAuthClient {
  if (!g.__csbGoogleOAuth) {
    const cfg = getConfig();
    if (cfg.googleClientId && cfg.googleClientSecret) g.__csbGoogleOAuth = new RealGoogleOAuthClient(cfg.googleClientId, cfg.googleClientSecret);
    else throw new AppError('NOT_CONFIGURED', 'Google 登入尚未設定（缺少 GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET）。');
  }
  return g.__csbGoogleOAuth;
}

export function setGoogleOAuth(c: GoogleOAuthClient | undefined) {
  g.__csbGoogleOAuth = c;
}
