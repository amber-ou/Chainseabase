import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Inter } from 'next/font/google';
import { GeistMono } from 'geist/font/mono'; // taste-skill-ignore: commands/coordinates only
// Traditional Chinese: Noto Sans TC, self-hosted (unicode-range slices: a page downloads only the
// characters it shows). Exactly the weights the typography tokens use, so the browser never fakes one.
import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/500.css';
import '@fontsource/noto-sans-tc/600.css';
import './globals.css';
import { getConfig, siteForHost } from '@/server/config';
import { SiteProvider, type SiteInfo } from '@/client/site';
import { InputModality } from '@/components/input-modality';
import { ToastProvider } from '@/components/toast';

export const dynamic = 'force-dynamic';

// Latin letters and digits: Inter (variable, every weight in one file), downloaded at build time by
// next/font and served from this app; no request goes to Google when the page loads.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Chainseabase',
  description: '公司內部多產品需求與回饋管理平台',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const site = siteForHost(h.get('x-forwarded-host') ?? h.get('host')) ?? 'portal';
  const cfg = getConfig();
  const info: SiteInfo = {
    site,
    adminOrigin: cfg.adminOrigin,
    portalOrigin: cfg.portalOrigin,
    googleLoginConfigured: Boolean(cfg.googleClientId && cfg.googleClientSecret),
    testLogin: cfg.e2eTestLogin,
    providers: { calendar: cfg.calendarProvider, email: cfg.emailProvider, storage: cfg.storageProvider },
  };
  return (
    <html lang="zh-Hant-TW" className={`${inter.variable} ${GeistMono.variable}`}>{/* taste-skill-ignore: mono variable for literal commands */}
      <body>
        <InputModality />
        <a className="skip-link" href="#main">跳到主要內容</a>
        <SiteProvider initial={info}>
          <ToastProvider>{children}</ToastProvider>
        </SiteProvider>
      </body>
    </html>
  );
}
