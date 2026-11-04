// Browser-only test fixture, never included in the Next.js route tree. The real LoginScreen with a
// configured Google login (the E2E server has none): ?site=portal, ?error=…, ?returnTo=… drive it.
import { createRoot } from 'react-dom/client';
import '@/app/globals.css';
import { SiteProvider, type SiteInfo } from '@/client/site';
import { LoginScreen } from '@/features/login';

const q = new URLSearchParams(window.location.search);
const site: SiteInfo = {
  site: q.get('site') === 'portal' ? 'portal' : 'admin',
  adminOrigin: window.location.origin, portalOrigin: window.location.origin,
  googleLoginConfigured: q.get('google') !== 'off', testLogin: false,
  providers: { calendar: 'fake', email: 'fake', storage: 'fake' },
};
createRoot(document.getElementById('root')!).render(<SiteProvider initial={site}><LoginScreen /></SiteProvider>);
