import { z } from 'zod';
import type { Router } from '../http';
import { uuidParam } from '../http';
import { getConfig, originForSite } from '../config';
import { getSql, withTx } from '../db';
import { AppError } from '../errors';
import { requireTeam, requireUser } from '../authz';
import { clearSessionCookie, createSession, revokeSession, sessionCookie } from '../session';
import { getGoogleOAuth, LOGIN_SCOPES, CALENDAR_SCOPES } from '../adapters/google-oauth';
import { getAvatarStorage } from '../adapters/storage';
import { FakeCalendarApi, getCalendarApi } from '../adapters/google-calendar';
import { clearTransientCookie, newTransient, pkceChallenge, readTransient, safeReturnTo, transientCookie, upsertGoogleUser } from '@/modules/identity/auth';
import { acceptInvitation, createInvitation, listInvitations, resendInvitation, revokeInvitation } from '@/modules/identity/invitations';
import { changeRole, meDto, removeMembership, updateMe } from '@/modules/identity/users';
import { AVATAR_MAX_BYTES, uploadAvatar } from '@/modules/identity/avatar';
import { saveCalendarGrant } from '@/modules/calendar/credentials';
import { logError } from '../log';
import { text, zRevision, zUuid } from '@/modules/shared/text';
import { mutate } from './helpers';

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

export function registerIdentityRoutes(r: Router) {
  // ---- Google sign-in (both sites, separate host-only sessions) ----
  r.get('/auth/google/start', ['admin', 'portal'], async (ctx) => {
    const returnTo = safeReturnTo(ctx.url.searchParams.get('returnTo'));
    const oauth = getGoogleOAuth();
    const t = newTransient('login', ctx.site, returnTo);
    const url = oauth.authorizationUrl({
      redirectUri: `${originForSite(ctx.site)}/api/v1/auth/google/callback`,
      state: t.state, codeChallenge: pkceChallenge(t.verifier), nonce: t.nonce, scopes: LOGIN_SCOPES,
    });
    return redirect(url, [await transientCookie(t)]);
  });

  r.get('/auth/google/callback', ['admin', 'portal'], async (ctx) => {
    const origin = originForSite(ctx.site);
    const err = ctx.url.searchParams.get('error');
    if (err) return redirect(`${origin}/login?error=denied`, [clearTransientCookie(ctx.site)]);
    let t;
    try {
      t = await readTransient(ctx.req, 'login', ctx.site, ctx.url.searchParams.get('state'));
    } catch {
      return redirect(`${origin}/login?error=state`, [clearTransientCookie(ctx.site)]);
    }
    try {
      const oauth = getGoogleOAuth();
      const tokens = await oauth.exchangeCode({
        code: ctx.url.searchParams.get('code') ?? '', codeVerifier: t.verifier,
        redirectUri: `${origin}/api/v1/auth/google/callback`,
      });
      if (!tokens.idToken) throw new AppError('AUTH_REQUIRED');
      const claims = await oauth.verifyIdToken(tokens.idToken, t.nonce);
      const sessionToken = await withTx(async (tx) => {
        const userId = await upsertGoogleUser(tx, claims);
        return createSession(tx, userId, ctx.site);
      });
      return redirect(`${origin}${t.returnTo}`, [clearTransientCookie(ctx.site), sessionCookie(ctx.site, sessionToken)]);
    } catch (e) {
      logError('auth.callback', e, { site: ctx.site });
      const code = e instanceof AppError && e.message.includes('Email') ? 'unverified' : 'failed';
      return redirect(`${origin}/login?error=${code}`, [clearTransientCookie(ctx.site)]);
    }
  });

  r.post('/auth/logout', ['admin', 'portal'], async (ctx) => {
    if (ctx.sessionHash) await revokeSession(getSql(), ctx.sessionHash);
    ctx.cookies.push(clearSessionCookie(ctx.site));
    return { data: { loggedOut: true } };
  });

  // ---- Test-only login (E2E): disabled unless E2E_TEST_LOGIN=enabled, never on production ----
  r.post('/test-support/login', ['admin', 'portal'], async (ctx) => {
    if (!getConfig().e2eTestLogin) throw new AppError('NOT_FOUND');
    const body = await ctx.body(z.object({ email: z.string().email(), name: z.string().min(1).max(100), sub: z.string().min(1).max(100) }));
    const token = await withTx(async (tx) => {
      const userId = await upsertGoogleUser(tx, { sub: body.sub, email: body.email.toLowerCase(), emailVerified: true, name: body.name, picture: null });
      return createSession(tx, userId, ctx.site);
    });
    ctx.cookies.push(sessionCookie(ctx.site, token));
    return { data: { ok: true, testOnly: true } };
  });

  // ---- Test-only: connect the in-memory fake calendar (dev/E2E; never Google, never production) ----
  r.post('/test-support/calendar/connect', ['admin'], async (ctx) => {
    const cfg = getConfig();
    if (!cfg.e2eTestLogin || cfg.calendarProvider !== 'fake') throw new AppError('NOT_FOUND');
    const user = requireTeam(ctx);
    const fake = getCalendarApi();
    if (!(fake instanceof FakeCalendarApi)) throw new AppError('NOT_FOUND');
    const sub = user.googleSub ?? `dev-${user.id}`;
    const body = await ctx.body(z.object({ calendarId: z.string().min(3).max(200).default('dev-product-calendar@fake.local'), role: z.enum(['owner', 'writer', 'reader']).default('writer') }).strict());
    if (!fake.calendars.has(body.calendarId)) fake.addCalendar(body.calendarId, 'Chainseabase 模擬日曆', 'Asia/Taipei', {});
    fake.calendars.get(body.calendarId)!.acl.set(sub, body.role);
    await withTx((tx) => saveCalendarGrant(tx, user.id, sub, {
      idToken: null, accessToken: `fake-access-${sub}-dev`, refreshToken: `fake-refresh-${sub}`, expiresIn: 3600, scope: ['openid', 'email', ...CALENDAR_SCOPES],
    }));
    return { data: { connected: true, calendarId: body.calendarId, fake: true } };
  });

  // ---- Site/session info ----
  r.get('/site', ['admin', 'portal'], async (ctx) => {
    const cfg = getConfig();
    return {
      data: {
        site: ctx.site, adminOrigin: cfg.adminOrigin, portalOrigin: cfg.portalOrigin,
        googleLoginConfigured: Boolean(cfg.googleClientId && cfg.googleClientSecret),
        testLogin: cfg.e2eTestLogin,
        providers: { calendar: cfg.calendarProvider, email: cfg.emailProvider, storage: cfg.storageProvider },
      },
    };
  });

  r.get('/me', ['admin', 'portal'], async (ctx) => {
    if (!ctx.user) return { data: null };
    return { data: await meDto(getSql(), ctx.user) };
  });

  r.patch('/me', ['admin', 'portal'], async (ctx) => {
    const user = requireUser(ctx);
    const body = await ctx.body(z.object({ displayName: text(1, 100, '名稱'), expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => {
      await updateMe(tx, user, body);
      const [u] = await tx<{ revision: number; displayName: string }[]>`select revision, display_name from users where id = ${user.id}`;
      return { data: { displayName: u.displayName, revision: u.revision } };
    });
  });

  r.post('/me/avatar-upload', ['admin', 'portal'], async (ctx) => {
    const user = requireUser(ctx);
    const ct = ctx.header('content-type') ?? '';
    if (!/^image\/(jpeg|png|webp)$/.test(ct)) throw new AppError('INVALID_REQUEST', '只接受 JPEG、PNG 或 WebP。', { fieldErrors: { file: '不支援的格式' } });
    const declared = Number(ctx.header('content-length') ?? '0');
    if (declared > AVATAR_MAX_BYTES) throw new AppError('INVALID_REQUEST', '頭像最大 2 MB。', { fieldErrors: { file: '檔案超過 2 MB' } });
    const buf = Buffer.from(await ctx.req.arrayBuffer());
    const res = await uploadAvatar(getSql(), user.id, buf);
    return { data: { avatarUrl: `/api/v1/avatars/${user.id}?v=${res.revision}`, revision: res.revision, storage: getAvatarStorage().mode } };
  });

  r.get('/avatars/:u', ['admin', 'portal'], async (ctx) => {
    const id = uuidParam(ctx, 'u');
    const [u] = await getSql()<{ avatarPath: string | null }[]>`select avatar_path from users where id = ${id}`;
    if (!u?.avatarPath) throw new AppError('NOT_FOUND');
    const obj = await getAvatarStorage().get(u.avatarPath);
    if (!obj) throw new AppError('NOT_FOUND');
    return new Response(new Uint8Array(obj.data), {
      headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=86400, immutable', 'x-content-type-options': 'nosniff' },
    });
  });

  // ---- Invitations ----
  r.get('/invitations', ['admin'], async (ctx) => {
    requireTeam(ctx);
    return { data: await listInvitations(getSql()) };
  });

  r.post('/invitations', ['admin'], async (ctx) => {
    const user = requireTeam(ctx);
    const body = await ctx.body(z.object({
      email: z.string().trim().email('Email 格式錯誤').max(254),
      role: z.enum(['team', 'tester']),
      productIds: z.array(zUuid).max(100).default([]),
    }).strict());
    return mutate(ctx, { keyRequired: true, body }, async (tx) => ({ status: 201, data: await createInvitation(tx, user, body) }));
  });

  r.post('/invitations/:id/resend', ['admin'], async (ctx) => {
    requireTeam(ctx);
    const id = uuidParam(ctx, 'id');
    const body = await ctx.body(z.object({ expectedRevision: zRevision }).strict());
    return mutate(ctx, { body }, async (tx) => ({ data: await resendInvitation(tx, id, body.expectedRevision) }));
  });

  r.delete('/invitations/:id', ['admin'], async (ctx) => {
    requireTeam(ctx);
    const id = uuidParam(ctx, 'id');
    const rev = ctx.ifMatchRevision();
    return mutate(ctx, { body: { rev } }, async (tx) => ({ data: await revokeInvitation(tx, id, rev) }));
  });

  r.post('/invitations/accept', ['admin', 'portal'], async (ctx) => {
    const user = requireUser(ctx);
    const body = await ctx.body(z.object({ token: z.string().min(20).max(200) }).strict());
    const res = await withTx((tx) => acceptInvitation(tx, user, body.token));
    return { data: res };
  });

  // ---- Membership ----
  r.patch('/users/:u/role', ['admin'], async (ctx) => {
    const actor = requireTeam(ctx);
    const userId = uuidParam(ctx, 'u');
    const body = await ctx.body(z.object({
      role: z.enum(['team', 'tester']), testerProductIds: z.array(zUuid).max(100).optional(), expectedRevision: zRevision,
    }).strict());
    return mutate(ctx, { body }, async (tx) => {
      await changeRole(tx, actor, userId, body);
      return { data: { userId, role: body.role } };
    });
  });

  r.delete('/users/:u/membership', ['admin'], async (ctx) => {
    requireTeam(ctx);
    const userId = uuidParam(ctx, 'u');
    const rev = ctx.ifMatchRevision();
    return mutate(ctx, { body: { rev } }, async (tx) => {
      await removeMembership(tx, userId, rev);
      return { data: { userId, removed: true } };
    });
  });

  // ---- Calendar incremental authorization (admin only, separate from login) ----
  r.get('/integrations/google/calendar/start', ['admin'], async (ctx) => {
    const user = requireTeam(ctx);
    const returnTo = safeReturnTo(ctx.url.searchParams.get('returnTo'));
    const t = newTransient('calendar', 'admin', returnTo);
    const url = getGoogleOAuth().authorizationUrl({
      redirectUri: `${originForSite('admin')}/api/v1/integrations/google/calendar/callback`,
      state: t.state, codeChallenge: pkceChallenge(t.verifier), nonce: t.nonce,
      scopes: ['openid', 'email', ...CALENDAR_SCOPES], loginHint: user.email, offline: true, forceConsent: true,
    });
    return redirect(url, [await transientCookie(t)]);
  });

  r.get('/integrations/google/calendar/callback', ['admin'], async (ctx) => {
    const origin = originForSite('admin');
    let t;
    try {
      t = await readTransient(ctx.req, 'calendar', 'admin', ctx.url.searchParams.get('state'));
    } catch {
      return redirect(`${origin}/?calendar=state_error`, [clearTransientCookie('admin')]);
    }
    const back = (code: string) => {
      const u = new URL(t.returnTo, origin);
      u.searchParams.set('calendar', code);
      return redirect(u.pathname + u.search, [clearTransientCookie('admin')]);
    };
    if (ctx.url.searchParams.get('error')) return back('denied');
    const user = ctx.user;
    if (!user || user.role !== 'team') return back('forbidden');
    try {
      const oauth = getGoogleOAuth();
      const tokens = await oauth.exchangeCode({
        code: ctx.url.searchParams.get('code') ?? '', codeVerifier: t.verifier,
        redirectUri: `${origin}/api/v1/integrations/google/calendar/callback`,
      });
      if (!tokens.idToken) return back('failed');
      const claims = await oauth.verifyIdToken(tokens.idToken, t.nonce);
      // the Calendar grant must belong to the same Google account as the platform login
      if (claims.sub !== user.googleSub) return back('wrong_account');
      await withTx((tx) => saveCalendarGrant(tx, user.id, claims.sub, tokens));
      return back('connected');
    } catch (e) {
      const code = e instanceof AppError ? e.code.toLowerCase() : 'failed';
      logError('calendar.callback', e, {});
      return back(code);
    }
  });
}
