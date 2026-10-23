import { NextResponse, type NextRequest } from 'next/server';
import { siteForHost } from '@/server/config';

/**
 * One app, two hosts. The host allowlist decides the site; each site only
 * serves its own pages (API routes enforce their own per-site rules).
 */
export function proxy(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const site = siteForHost(host);
  const path = req.nextUrl.pathname;
  if (!site) return new NextResponse('Unknown host', { status: 421 });
  if (path.startsWith('/api/')) return NextResponse.next();
  const shared = path === '/login' || path === '/invite' || path === '/';
  const adminOnly = path.startsWith('/products');
  const portalOnly = path.startsWith('/p/');
  if (shared) return NextResponse.next();
  if (site === 'admin' && portalOnly) return NextResponse.rewrite(new URL('/not-found-page', req.url), { status: 404 });
  if (site === 'portal' && adminOnly) return NextResponse.rewrite(new URL('/not-found-page', req.url), { status: 404 });
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
