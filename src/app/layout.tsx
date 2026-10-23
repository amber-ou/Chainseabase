import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/500.css';
import './globals.css';
import { getConfig, siteForHost } from '@/server/config';
import { SiteProvider, type SiteInfo } from '@/client/site';
import { ToastProvider } from '@/components/toast';

export const dynamic = 'force-dynamic';

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
    <html lang="zh-Hant-TW" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <a className="skip-link" href="#main">跳到主要內容</a>
        <SiteProvider initial={info}>
          <ToastProvider>{children}</ToastProvider>
        </SiteProvider>
      </body>
    </html>
  );
}
