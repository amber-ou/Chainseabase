import { NextResponse, type NextRequest } from 'next/server';
import { siteForHost } from '@/server/config';

// the session cookie's name (src/server/session.ts); not imported, to keep the database out of the proxy
const SESSION_COOKIE = 'csb_session';

/**
 * One app, two hosts. The host allowlist decides the site; each site only
 * serves its own pages (API routes enforce their own per-site rules).
 */
export function proxy(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const site = siteForHost(host);
  const path = req.nextUrl.pathname;
  if (path.startsWith('/api/')) return NextResponse.next(); // the API router enforces its own host rules
  if (!site) return new NextResponse('Unknown host', { status: 421 });
  const shared = path === '/login' || path === '/invite' || path === '/';
  const adminOnly = path.startsWith('/products');
  const portalOnly = path.startsWith('/p/');
  // admin without a session: straight to the Login page (phase 6), keeping where they were going. Only
  // the cookie's presence is checked here; an expired or revoked session is sent there by the shell.
  if (site === 'admin' && (path === '/' || path === '/products' || path.startsWith('/products/')) && !req.cookies.has(SESSION_COOKIE)) {
    const back = path === '/' ? '/products' : path + req.nextUrl.search;
    const to = req.nextUrl.clone();
    to.pathname = '/login';
    to.search = '';
    to.searchParams.set('returnTo', back);
    return NextResponse.redirect(to, { status: 307, headers: { 'cache-control': 'no-store' } });
  }
  if (shared) return NextResponse.next();
  if (site === 'admin' && portalOnly) return NextResponse.rewrite(new URL('/not-found-page', req.url), { status: 404 });
  if (site === 'portal' && adminOnly) return NextResponse.rewrite(new URL('/not-found-page', req.url), { status: 404 });
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
