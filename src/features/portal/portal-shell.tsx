'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { api, type ApiError } from '@/client/api';
import { useResource } from '@/client/hooks';
import { loginHref, useSite } from '@/client/site';
import { Avatar, Button, DeniedState, ErrorState, LoadingState } from '@/components/ui';
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
      <Button size="sm" variant="ghost" onClick={logout}>登出</Button>
    </span>
  );
}

async function logout() {
  await api.post('/auth/logout');
  window.location.reload();
}

/**
 * WIN-04: the portal is for invited members only. Reads answer 401 without a login and 404 for
 * anything the account cannot read (also for uninvited or removed accounts, whose own role from
 * /me says why). No product content is shown in either case.
 */
export function PortalNotInvited() {
  const { me } = useSite();
  return <DeniedState title="尚未受邀" message={`目前登入的 ${me?.email ?? '帳號'} 尚未受邀，或成員資格已被移除。需要使用請聯絡團隊寄送邀請。`} action={<Button size="sm" onClick={logout}>改用其他帳號</Button>} />;
}

export function PortalAccessState({ error }: { error: ApiError | null }) {
  const pathname = usePathname();
  const { me, meLoaded } = useSite();
  if (error?.isAuth) {
    return <DeniedState title="請先登入" message="此網站只供受邀成員使用，請以收到邀請的 Google 帳號登入。" action={<a className="btn btn-primary" href={loginHref(pathname)}>前往登入</a>} />;
  }
  // wait for /me so an uninvited account is not first shown "not found"
  if (error?.isNotFound && !meLoaded) return <LoadingState />;
  if (me?.role === 'none' && (error?.isNotFound || error?.code === 'NOT_A_MEMBER')) return <PortalNotInvited />;
  if (error?.isNotFound) return <ErrorState title="找不到產品" message="產品不存在，或你沒有受邀參與這個產品。" />;
  return <ErrorState message={error?.message} />;
}

export function PortalShell({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const res = useResource<PublicProduct>(`/public/products/${encodeURIComponent(slug)}`);
  const { me } = useSite();
  if (res.loading) return <main id="main" tabIndex={-1} className="portal-main"><LoadingState /></main>;
  if (res.error || !res.data) {
    return (
      <>
        <header className="portal-top">
          <Link className="brand" style={{ padding: 0 }} href="/"><Logo /><span>Chainseabase 回饋</span></Link>
          <span style={{ marginLeft: 'auto' }}><PortalUserBox /></span>
        </header>
        <main id="main" tabIndex={-1} className="portal-main"><PortalAccessState error={res.error} /></main>
      </>
    );
  }
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
      <main id="main" tabIndex={-1} className="portal-main">{children}</main>
    </Ctx.Provider>
  );
}
