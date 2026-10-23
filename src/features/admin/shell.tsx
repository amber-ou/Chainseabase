'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/client/api';
import { useResource, useVisiblePolling } from '@/client/hooks';
import { loginHref, useSite } from '@/client/site';
import { relativeTime } from '@/client/format';
import { Avatar, Button, DeniedState, ErrorState, LoadingState, useDismiss } from '@/components/ui';
import { ConfirmModal } from '@/components/modal';
import {
  IconBell, IconFeedback, IconMenu, IconPersonal, IconPortal, IconProduct, IconRoadmap, IconSettings, IconUsers, IconX, Logo,
} from '@/components/icons';

export interface ProductItem { id: string; name: string; slug: string; revision: number; createdAt: string }

interface ProductCtx {
  product: ProductItem;
  products: ProductItem[];
  reloadProducts: () => Promise<void>;
  /** Register unsaved work so product switches can warn first. */
  setDirty: (key: string, dirty: boolean) => void;
}

const Ctx = createContext<ProductCtx | null>(null);
export function useProduct() {
  const c = useContext(Ctx);
  if (!c) throw new Error('ProductContext missing');
  return c;
}

/** Mark a form as having unsaved input while `dirty` is true. */
export function useUnsaved(key: string, dirty: boolean) {
  const { setDirty } = useProduct();
  useEffect(() => {
    setDirty(key, dirty);
    return () => setDirty(key, false);
  }, [key, dirty, setDirty]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
}

const SECTIONS = [
  { key: 'dashboard', label: 'Product', icon: IconProduct },
  { key: 'feedback', label: 'Feedback', icon: IconFeedback },
  { key: 'roadmaps', label: 'Roadmap', icon: IconRoadmap },
  { key: 'personal', label: 'Personal', icon: IconPersonal },
] as const;
const SECTIONS_AFTER = [
  { key: 'users', label: 'User', icon: IconUsers },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const { productId } = useParams<{ productId: string }>();
  const { site, me, meLoaded } = useSite();
  const pathname = usePathname();
  const router = useRouter();
  const products = useResource<ProductItem[]>(me?.role === 'team' ? '/products' : null);
  const dirty = useRef(new Set<string>());
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const setDirty = useCallback((key: string, d: boolean) => {
    if (d) dirty.current.add(key);
    else dirty.current.delete(key);
  }, []);

  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    try { if (productId) localStorage.setItem('csb:lastProduct', productId); } catch { /* storage unavailable */ }
  }, [productId]);

  if (!meLoaded) return <main id="main" className="main"><LoadingState /></main>;
  if (!me) {
    return (
      <main id="main" className="login-wrap">
        <DeniedState title="請先登入" message="後台需要團隊成員以 Google 登入。" action={<a className="btn btn-primary" href={loginHref(pathname)}>前往登入</a>} />
      </main>
    );
  }
  if (me.role !== 'team') {
    return (
      <main id="main" className="login-wrap">
        <DeniedState title="沒有後台權限" message={`目前登入的 ${me.email} 不是團隊成員。測試成員請使用前台網站。`} action={<a className="btn" href={site.portalOrigin}>前往前台網站</a>} />
      </main>
    );
  }
  if (products.loading) return <main id="main" className="main"><LoadingState /></main>;
  if (products.error) return <main id="main" className="main"><ErrorState message={products.error.message} onRetry={products.reload} /></main>;
  const list = products.data ?? [];
  const product = list.find((p) => p.id === productId);
  if (!product) {
    return <main id="main" className="main"><ErrorState title="找不到產品" message="此產品不存在。" />{list[0] ? <p style={{ marginTop: 12 }}><Link className="btn" href={`/products/${list[0].id}/dashboard`}>前往 {list[0].name}</Link></p> : null}</main>;
  }
  const section = pathname.split('/')[3] ?? 'dashboard';
  const go = (href: string) => {
    if (dirty.current.size > 0) setPendingNav(href);
    else router.push(href);
  };
  const switchProduct = (id: string) => go(`/products/${id}/${['dashboard', 'feedback', 'roadmaps', 'personal', 'users', 'settings'].includes(section) ? section : 'dashboard'}`);
  const current = [...SECTIONS, ...SECTIONS_AFTER, { key: 'settings', label: 'Setting' }].find((s) => s.key === section)?.label ?? 'Product';

  const nav = (
    <>
      <Link className="brand" href={`/products/${product.id}/dashboard`}><Logo /><span>Chainseabase</span></Link>
      <div className="product-switch">
        <label className="sr-only" htmlFor="product-switch">切換產品</label>
        <select id="product-switch" className="select" value={product.id} onChange={(e) => switchProduct(e.target.value)}>
          {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <nav className="nav" aria-label="後台導覽">
        {SECTIONS.map((s) => (
          <NavLink key={s.key} href={`/products/${product.id}/${s.key}`} active={section === s.key} onNavigate={go} icon={<s.icon />}>{s.label}</NavLink>
        ))}
        <a className="nav-item" href={`${site.portalOrigin}/p/${product.slug}/feedback`}><IconPortal />Live Portal</a>
        {SECTIONS_AFTER.map((s) => (
          <NavLink key={s.key} href={`/products/${product.id}/${s.key}`} active={section === s.key} onNavigate={go} icon={<s.icon />}>{s.label}</NavLink>
        ))}
        <NotificationsButton productId={product.id} onOpenFeedback={(id) => go(`/products/${product.id}/feedback?item=${id}`)} />
        <NavLink href={`/products/${product.id}/settings`} active={section === 'settings'} onNavigate={go} icon={<IconSettings />}>Setting</NavLink>
      </nav>
      <div className="sidebar-foot">
        <div className="user-row">
          <Avatar name={me.displayName} url={me.avatarUrl} id={me.id} size={28} />
          <div style={{ minWidth: 0 }}>
            <div className="name">{me.displayName}</div>
            <div className="name small muted">{me.email}</div>
          </div>
        </div>
        {/* full navigation after logout drops all client state of the old session */}
        {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination */}
        <Button size="sm" variant="ghost" onClick={async () => { await api.post('/auth/logout'); window.location.assign('/login'); }}>登出</Button>
      </div>
    </>
  );

  return (
    <Ctx.Provider value={{ product, products: list, reloadProducts: products.reload, setDirty }}>
      <div className="shell">
        <aside className="sidebar">{nav}</aside>
        <header className="topbar">
          <Button variant="ghost" icon aria-label="開啟選單" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><IconMenu /></Button>
          <span className="screen-name">{current} · {product.name}</span>
        </header>
        <div className="mobile-sheet" data-open={menuOpen} role="dialog" aria-modal="true" aria-label="選單" hidden={!menuOpen}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button variant="ghost" icon aria-label="關閉選單" onClick={() => setMenuOpen(false)}><IconX /></Button></div>
          {menuOpen ? nav : null}
        </div>
        <main id="main" className="main" key={product.id}>{children}</main>
      </div>
      {pendingNav ? (
        <ConfirmModal title="有尚未儲存的內容" confirmLabel="放棄並離開" danger onCancel={() => setPendingNav(null)}
          onConfirm={() => { dirty.current.clear(); const href = pendingNav; setPendingNav(null); router.push(href); }}>
          目前的表單或草稿尚未儲存。離開後這些內容不會寫入任何產品。
        </ConfirmModal>
      ) : null}
    </Ctx.Provider>
  );
}

function NavLink({ href, active, children, icon, onNavigate }: { href: string; active: boolean; children: ReactNode; icon: ReactNode; onNavigate: (href: string) => void }) {
  return (
    <a className="nav-item" href={href} aria-current={active ? 'page' : undefined} onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      onNavigate(href);
    }}>{icon}{children}</a>
  );
}

const REASON_TEXT: Record<string, string> = { assigned: '指派你為負責人', comment: '在你建立的 Feedback 留言', schedule_comment: '在你建立的 Feedback 新增 Schedule 留言' };

interface NotificationItem { id: string; reasons: string[]; feedback: { id: string; title: string }; actor: { id: string; displayName: string; avatarUrl: string | null } | null; createdAt: string; readAt: string | null }

export function NotificationsButton({ productId, onOpenFeedback, basePath = `/products/${productId}` }: { productId: string; onOpenFeedback: (feedbackId: string) => void; basePath?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const res = useResource<NotificationItem[]>(`${basePath}/notifications?limit=30`);
  // foreground polling every 30s; paused in background tabs
  useVisiblePolling(() => { void res.reload(); }, 30_000);
  const unread = res.meta.unreadCount ?? 0;
  const markRead = async (n: NotificationItem) => {
    if (!n.readAt) {
      try { await api.put(`${basePath}/notifications/${n.id}/read`); } catch { /* keep list as-is */ }
    }
    setOpen(false);
    void res.reload();
    onOpenFeedback(n.feedback.id);
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="nav-item" aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen((o) => !o); void res.reload(); }}>
        <IconBell />Notification{unread > 0 ? <span className="nav-badge num" aria-label={`${unread} 則未讀`}>{unread}</span> : null}
      </button>
      {open ? (
        <div className="popover" role="dialog" aria-label="通知" style={{ left: 0, top: 'calc(100% + 4px)', width: 340, maxHeight: 440, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px 8px' }}>
            <strong>通知</strong>
            <Button size="sm" variant="ghost" disabled={unread === 0} onClick={async () => { await api.put(`${basePath}/notifications/read`, { body: { before: new Date().toISOString() } }); void res.reload(); }}>全部標為已讀</Button>
          </div>
          {res.loading ? <LoadingState /> : res.error ? <ErrorState message={res.error.message} onRetry={res.reload} /> : (res.data ?? []).length === 0 ? (
            <div className="muted" style={{ padding: 8 }}>目前沒有通知。</div>
          ) : (
            <div className="menu">
              {(res.data ?? []).map((n) => (
                <button key={n.id} type="button" className="menu-item" onClick={() => markRead(n)} style={{ alignItems: 'flex-start' }}>
                  <Avatar name={n.actor?.displayName ?? '?'} url={n.actor?.avatarUrl} id={n.actor?.id} size={24} />
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <span style={{ fontWeight: n.readAt ? 400 : 500 }}>{n.actor?.displayName ?? '有人'}{n.reasons.map((r) => REASON_TEXT[r] ?? r).join('，')}</span>
                    <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.feedback.title}</span>
                    <span className="small muted">{relativeTime(n.createdAt)}{n.readAt ? '' : ' · 未讀'}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
