'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '@/client/api';
import { useResource, useVisiblePolling } from '@/client/hooks';
import { loginHref, useSite } from '@/client/site';
import { relativeTime } from '@/client/format';
import { Avatar, Button, DeniedState, ErrorState, LoadingState, useDismiss } from '@/components/ui';
import { ConfirmModal, FOCUSABLE } from '@/components/modal';
import {
  IconBell, IconCalendar, IconFeedback, IconMenu, IconPersonal, IconPortal, IconProduct, IconRoadmap, IconSettings, IconUsers, IconX,
} from '@/components/icons';
import { BrandMark } from '@/components/brand';

export interface ProductItem { id: string; name: string; slug: string; revision: number; createdAt: string }

interface ProductCtx {
  /** The selected product; null on the product list when none is selected (or none exists). */
  product: ProductItem | null;
  products: ProductItem[];
  reloadProducts: () => Promise<void>;
  /** Register unsaved work so product switches can warn first. */
  setDirty: (key: string, dirty: boolean) => void;
}

const Ctx = createContext<ProductCtx | null>(null);
/** For pages of one product: the shell only renders them once that product exists. */
export function useProduct(): ProductCtx & { product: ProductItem } {
  const c = useContext(Ctx);
  if (!c?.product) throw new Error('ProductContext missing');
  return c as ProductCtx & { product: ProductItem };
}
/** For the product list, which also works with no product selected. */
export function useProductList() {
  const c = useContext(Ctx);
  if (!c) throw new Error('ProductContext missing');
  return c;
}

// the product last opened; '' means "none selected" (after deleting the selected product)
export const LAST_PRODUCT_KEY = 'csb:lastProduct';
export function readLastProduct(): string | null {
  try { return localStorage.getItem(LAST_PRODUCT_KEY); } catch { return null; }
}
export function writeLastProduct(id: string) {
  try { localStorage.setItem(LAST_PRODUCT_KEY, id); } catch { /* storage unavailable */ }
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

// sidebar groups (docs/change-requests/sidebar-position.md): the top group, then Live Portal;
// the bottom group (Personal, Notification, Setting) sits just above the account area
const SECTIONS = [
  { key: 'dashboard', label: 'Product', icon: IconProduct },
  { key: 'calendar', label: 'Calendar', icon: IconCalendar },
  { key: 'feedback', label: 'Feedback', icon: IconFeedback },
  { key: 'roadmaps', label: 'Roadmap', icon: IconRoadmap },
  { key: 'users', label: 'User', icon: IconUsers },
] as const;
const SECTIONS_BOTTOM = [
  { key: 'personal', label: 'Personal', icon: IconPersonal },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  // no product id on /products: the product list with no product selected
  const { productId } = useParams<{ productId?: string }>();
  const { site, me, meLoaded, meError, reloadMe } = useSite();
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
  // phone menu sheet is a modal dialog: focus moves in, Tab stays inside, Escape closes, and
  // focus returns to the menu button (or into <main> when a link navigated away)
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetOpenedAt = useRef<string | null>(null);
  useEffect(() => {
    if (!menuOpen) {
      if (sheetOpenedAt.current === null) return;
      const navigated = sheetOpenedAt.current !== window.location.pathname;
      sheetOpenedAt.current = null;
      (navigated ? document.getElementById('main') : menuBtnRef.current)?.focus();
      return;
    }
    sheetOpenedAt.current = window.location.pathname;
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setMenuOpen(false); return; }
      if (e.key !== 'Tab' || !sheet) return;
      const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  // remembered only once the product is known to exist (a deleted product is never stored)
  const found = Boolean(productId && products.data?.some((p) => p.id === productId));
  useEffect(() => {
    if (found && productId) writeLastProduct(productId);
  }, [found, productId]);

  if (!meLoaded) return <main id="main" tabIndex={-1} className="main"><LoadingState /></main>;
  // the account could not be read (network or server): say so, never send a signed-in person to login
  if (!me && meError) return <main id="main" tabIndex={-1} className="main"><ErrorState message="無法確認登入狀態，請檢查連線後重試。" onRetry={reloadMe} /></main>;
  // not signed in (or the session expired): straight to the Login page, back here afterwards
  if (!me) return <main id="main" tabIndex={-1} className="main"><ToLogin /></main>;
  if (me.role !== 'team') {
    return (
      <main id="main" tabIndex={-1} className="login-wrap">
        <DeniedState title="沒有後台權限" message={`目前登入的 ${me.email} 不是團隊成員。測試成員請使用前台網站。`} action={<a className="btn" href={site.portalOrigin}>前往前台網站</a>} />
      </main>
    );
  }
  if (products.loading) return <main id="main" tabIndex={-1} className="main"><LoadingState /></main>;
  if (products.error) return <main id="main" tabIndex={-1} className="main"><ErrorState message={products.error.message} onRetry={products.reload} /></main>;
  const list = products.data ?? [];
  const product = productId ? list.find((p) => p.id === productId) ?? null : null;
  if (productId && !product) {
    // an old link or another tab of a deleted product: nothing of it is requested or shown
    return <main id="main" tabIndex={-1} className="main"><ErrorState title="找不到產品" message="此產品不存在，可能已被刪除。" /><p style={{ marginTop: 12 }}><Link className="btn" href="/products">返回 Product</Link></p></main>;
  }
  const section = product ? pathname.split('/')[3] ?? 'dashboard' : 'dashboard';
  const go = (href: string) => {
    if (dirty.current.size > 0) setPendingNav(href);
    else router.push(href);
  };
  const switchProduct = (id: string) => go(`/products/${id}/${['dashboard', 'calendar', 'feedback', 'roadmaps', 'personal', 'users', 'settings'].includes(section) ? section : 'dashboard'}`);
  const current = [...SECTIONS, ...SECTIONS_BOTTOM, { key: 'settings', label: 'Setting' }].find((s) => s.key === section)?.label ?? 'Product';

  const foot = (
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
  );
  // with no product selected, the product sections are shown but cannot open (no request is made for them)
  const needProduct = list.length ? '請先從 Product 選取產品' : '請先在 Product 新增產品';
  const off = (label: string, icon: ReactNode) => (
    <span key={label} className="nav-item" aria-disabled="true" title={needProduct} aria-describedby="nav-need-product">{icon}{label}</span>
  );
  const nav = product ? (
    <>
      <Link className="brand" href={`/products/${product.id}/dashboard`}><BrandMark /><span>Chainseabase</span></Link>
      <div className="product-switch">
        <label className="sr-only" htmlFor="product-switch">切換產品</label>
        <select id="product-switch" className="select" value={product.id} onChange={(e) => switchProduct(e.target.value)}>
          {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <nav className="nav" aria-label="後台導覽">
        <div className="nav-group">
          {SECTIONS.map((s) => (
            <NavLink key={s.key} href={`/products/${product.id}/${s.key}`} active={section === s.key} onNavigate={go} icon={<s.icon />}>{s.label}</NavLink>
          ))}
          <a className="nav-item" href={`${site.portalOrigin}/p/${product.slug}/feedback`}><IconPortal />Live Portal</a>
        </div>
        <div className="nav-group nav-group-bottom">
          {SECTIONS_BOTTOM.map((s) => (
            <NavLink key={s.key} href={`/products/${product.id}/${s.key}`} active={section === s.key} onNavigate={go} icon={<s.icon />}>{s.label}</NavLink>
          ))}
          <NotificationsButton productId={product.id} onOpenFeedback={(id) => go(`/products/${product.id}/feedback?item=${id}`)} />
          <NavLink href={`/products/${product.id}/settings`} active={section === 'settings'} onNavigate={go} icon={<IconSettings />}>Setting</NavLink>
        </div>
      </nav>
      {foot}
    </>
  ) : (
    <>
      <Link className="brand" href="/products"><BrandMark /><span>Chainseabase</span></Link>
      <div className="product-switch">
        <label className="sr-only" htmlFor="product-switch">切換產品</label>
        <select id="product-switch" className="select" value="" disabled={!list.length} onChange={(e) => { if (e.target.value) go(`/products/${e.target.value}/dashboard`); }}>
          <option value="" disabled>{list.length ? '尚未選取產品' : '尚無產品'}</option>
          {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <nav className="nav" aria-label="後台導覽">
        <p id="nav-need-product" className="small muted" style={{ margin: '0 10px 6px' }}>{needProduct}</p>
        <div className="nav-group">
          <NavLink href="/products" active onNavigate={go} icon={<IconProduct />}>Product</NavLink>
          {SECTIONS.filter((s) => s.key !== 'dashboard').map((s) => off(s.label, <s.icon />))}
          {off('Live Portal', <IconPortal />)}
        </div>
        <div className="nav-group nav-group-bottom">
          {SECTIONS_BOTTOM.map((s) => off(s.label, <s.icon />))}
          {off('Notification', <IconBell />)}
          {off('Setting', <IconSettings />)}
        </div>
      </nav>
      {foot}
    </>
  );

  return (
    <Ctx.Provider value={{ product, products: list, reloadProducts: products.reload, setDirty }}>
      <div className="shell">
        <aside className="sidebar">{nav}</aside>
        <header className="topbar">
          <Button ref={menuBtnRef} variant="ghost" icon aria-label="開啟選單" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><IconMenu /></Button>
          <span className="screen-name">{product ? `${current} · ${product.name}` : 'Product'}</span>
        </header>
        <div ref={sheetRef} className="mobile-sheet" data-open={menuOpen} role="dialog" aria-modal="true" aria-label="選單" hidden={!menuOpen}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button variant="ghost" icon aria-label="關閉選單" onClick={() => setMenuOpen(false)}><IconX /></Button></div>
          {menuOpen ? nav : null}
        </div>
        <main id="main" tabIndex={-1} className="main" key={product?.id ?? 'none'}>{children}</main>
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

/** Replaces the page with Login (no history entry for the page that needed a session). */
function ToLogin() {
  useEffect(() => {
    window.location.replace(loginHref(window.location.pathname + window.location.search));
  }, []);
  return <LoadingState label="正在前往登入頁…" />;
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref, triggerRef);
  // keyboard: focus moves into the panel when it opens (even when it has nothing actionable)
  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);
  // the panel is placed against the viewport next to its button, opening up or down wherever there is
  // more room: from the bottom of the sidebar it opens upward, and the scrolling sidebar cannot clip it
  const [place, setPlace] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(340, window.innerWidth - 16);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      const above = r.top - 12, below = window.innerHeight - r.bottom - 12;
      setPlace(above > below
        ? { position: 'fixed', left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(440, above) }
        : { position: 'fixed', left, width, top: r.bottom + 4, maxHeight: Math.min(440, below) });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open]);
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
    <div ref={ref} style={{ position: 'relative' }}
      onBlur={(e) => { if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={triggerRef} type="button" className="nav-item" aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen((o) => !o); void res.reload(); }}>
        <IconBell />Notification{unread > 0 ? <span className="nav-badge num" aria-label={`${unread} 則未讀`}>{unread}</span> : null}
      </button>
      {open ? (
        <div ref={panelRef} tabIndex={-1} className="popover" role="dialog" aria-label="通知" style={{ ...place, overflowY: 'auto' }}>
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
