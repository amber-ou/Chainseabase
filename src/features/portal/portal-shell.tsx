'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { api } from '@/client/api';
import { useResource } from '@/client/hooks';
import { loginHref, useSite } from '@/client/site';
import { Avatar, Button, ErrorState, LoadingState } from '@/components/ui';
import { Logo } from '@/components/icons';
import { NotificationsButton } from '@/features/admin/shell';

export interface PublicProduct { id: string; name: string; slug: string; viewer: { loggedIn: boolean; canInteract: boolean; isTeam: boolean } }
const Ctx = createContext<{ product: PublicProduct; reload: () => Promise<void> } | null>(null);
export function usePortalProduct() {
  const c = useContext(Ctx);
  if (!c) throw new Error('PortalShell missing');
  return c;
}

export function PortalUserBox() {
  const { me, meLoaded } = useSite();
  const pathname = usePathname();
  if (!meLoaded) return null;
  if (!me) return <a className="btn btn-sm" href={loginHref(pathname)}>登入</a>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Avatar name={me.displayName} url={me.avatarUrl} id={me.id} size={24} />
      <span className="small" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.displayName}</span>
      <Button size="sm" variant="ghost" onClick={async () => { await api.post('/auth/logout'); window.location.reload(); }}>登出</Button>
    </span>
  );
}

export function PortalShell({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const res = useResource<PublicProduct>(`/public/products/${encodeURIComponent(slug)}`);
  const { me } = useSite();
  if (res.loading) return <main id="main" className="portal-main"><LoadingState /></main>;
  if (res.error || !res.data) return <main id="main" className="portal-main"><ErrorState title={res.error?.isNotFound ? '找不到產品' : '讀取失敗'} message={res.error?.message} /></main>;
  const p = res.data;
  const section = pathname.split('/')[3] ?? 'feedback';
  return (
    <Ctx.Provider value={{ product: p, reload: res.reload }}>
      <header className="portal-top">
        <Link className="brand" style={{ padding: 0 }} href="/"><Logo /><span>{p.name}</span></Link>
        <nav aria-label="前台導覽">
          <a className="nav-item" style={{ width: 'auto' }} href={`/p/${p.slug}/feedback`} aria-current={section === 'feedback' ? 'page' : undefined}>Feedback</a>
          <a className="nav-item" style={{ width: 'auto' }} href={`/p/${p.slug}/roadmap`} aria-current={section === 'roadmap' ? 'page' : undefined}>Roadmap</a>
        </nav>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {me && p.viewer.canInteract ? <NotificationsButton productId={p.id} basePath={`/portal/products/${p.id}`} onOpenFeedback={(id) => router.push(`/p/${p.slug}/feedback?item=${id}`)} /> : null}
          <PortalUserBox />
        </span>
      </header>
      {me && !p.viewer.canInteract ? (
        <div className="banner" role="note" style={{ borderRadius: 0 }}>你已登入，但尚未受邀參與「{p.name}」，目前只能瀏覽公開內容。需要互動請聯絡團隊寄送邀請。</div>
      ) : null}
      <main id="main" className="portal-main">{children}</main>
    </Ctx.Provider>
  );
}
