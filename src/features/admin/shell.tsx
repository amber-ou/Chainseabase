'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';
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
import { ChevronsUpDownIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { writeSidebarCookie } from '@/client/sidebar-pref';

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
// the bottom group (Personal, Notification) sits just above the account area, which opens Setting
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
  // NAV-01/02: desktop icon collapse; the first value comes from the server (cookie), so no layout jump
  const [collapsed, setCollapsed] = useState(Boolean(site.sidebarCollapsed));
  const toggleSidebar = () => setCollapsed((c) => { writeSidebarCookie(!c); return !c; });
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
    return <main id="main" tabIndex={-1} className="main"><ErrorState title="找不到產品" message="此產品不存在，可能已被刪除。" next={<Link className="btn" href="/products">返回 Product</Link>} /></main>;
  }
  const section = product ? pathname.split('/')[3] ?? 'dashboard' : pathname === '/products/settings' ? 'settings' : 'dashboard';
  const go = (href: string) => {
    if (dirty.current.size > 0) setPendingNav(href);
    else router.push(href);
  };
  const switchProduct = (id: string) => go(`/products/${id}/${['dashboard', 'calendar', 'feedback', 'roadmaps', 'personal', 'users', 'settings'].includes(section) ? section : 'dashboard'}`);
  const current = [...SECTIONS, ...SECTIONS_BOTTOM, { key: 'settings', label: 'Setting' }].find((s) => s.key === section)?.label ?? 'Product';

  // A01: the whole account area is the entry to Setting (no menu in between); A03: logout lives in Setting
  const settingsHref = product ? `/products/${product.id}/settings` : '/products/settings';
  const onSettings = section === 'settings';
  const foot = (compact: boolean) => (
    <div className="sidebar-foot">
      <SideTip on={compact} label={`Setting（${me.displayName}）`}>
        <NavLink href={settingsHref} active={onSettings} onNavigate={go} className="user-row account-entry">
          <Avatar name={me.displayName} url={me.avatarUrl} id={me.id} size={28} />
          <span className="account-text">
            <span className="name">{me.displayName}</span>
            <span className="name small muted">{me.email}</span>
          </span>
          <span className="sr-only">（開啟 Setting）</span>
          <IconSettings />
        </NavLink>
      </SideTip>
    </div>
  );
  // with no product selected, the product sections are shown but cannot open (no request is made for them)
  const needProduct = list.length ? '請先從 Product 選取產品' : '請先在 Product 新增產品';
  // the off items stay plain, non-focusable text as before; collapsed, a tooltip names them on hover
  const off = (compact: boolean, label: string, icon: ReactNode) => (
    <SideTip key={label} on={compact} label={`${label}（${needProduct}）`}>
      <span className="nav-item" aria-disabled="true" title={compact ? undefined : needProduct} aria-describedby="nav-need-product">{icon}<span className="nav-label">{label}</span></span>
    </SideTip>
  );
  const item = (compact: boolean, key: string, href: string, label: string, icon: ReactNode, active: boolean) => (
    <SideTip key={key} on={compact} label={label}>
      <NavLink href={href} active={active} onNavigate={go} icon={icon}><span className="nav-label">{label}</span></NavLink>
    </SideTip>
  );
  // NAV-01: the brand area; on the desktop sidebar its right end holds the collapse toggle (always shown)
  const brand = (inSidebar: boolean, compact: boolean) => (
    <div className="brand-row">
      <SideTip on={compact} label="Chainseabase">
        <Link className="brand" href={product ? `/products/${product.id}/dashboard` : '/products'}><BrandMark /><span className="nav-label">Chainseabase</span></Link>
      </SideTip>
      {inSidebar ? (
        <SideTip on label={compact ? '展開側邊欄' : '收合側邊欄'} side={compact ? 'right' : 'bottom'}>
          <button type="button" className="sidebar-toggle" aria-label={compact ? '展開側邊欄' : '收合側邊欄'} aria-expanded={!compact} aria-controls="admin-sidebar" onClick={toggleSidebar}>
            {compact ? <PanelLeftOpenIcon aria-hidden="true" /> : <PanelLeftCloseIcon aria-hidden="true" />}
          </button>
        </SideTip>
      ) : null}
    </div>
  );
  // NAV-04: collapsed, the product select becomes an icon entry with the same choices (and the same
  // unsaved-work guard); with no product it still opens and says so
  const productSwitch = (compact: boolean) => compact ? (
    <CompactProductSwitch product={product} list={list} onPick={(id) => product ? switchProduct(id) : go(`/products/${id}/dashboard`)} />
  ) : product ? (
    <div className="product-switch">
      <label className="product-switch-label" htmlFor="product-switch">目前產品<span className="sr-only">（切換產品）</span></label>
      <select id="product-switch" className="select" value={product.id} onChange={(e) => switchProduct(e.target.value)}>
        {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  ) : (
    <div className="product-switch">
      <label className="product-switch-label" htmlFor="product-switch">目前產品<span className="sr-only">（切換產品）</span></label>
      <select id="product-switch" className="select" value="" disabled={!list.length} onChange={(e) => { if (e.target.value) go(`/products/${e.target.value}/dashboard`); }}>
        <option value="" disabled>{list.length ? '尚未選取產品' : '尚無產品'}</option>
        {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );
  const nav = (inSidebar: boolean) => {
    const compact = inSidebar && collapsed;
    return product ? (
      <>
        {brand(inSidebar, compact)}
        {productSwitch(compact)}
        <nav className="nav" aria-label="後台導覽">
          <div className="nav-group">
            {SECTIONS.map((s) => item(compact, s.key, `/products/${product.id}/${s.key}`, s.label, <s.icon />, section === s.key))}
            <SideTip on={compact} label="Live Portal">
              <a className="nav-item" href={`${site.portalOrigin}/p/${product.slug}/feedback`}><IconPortal /><span className="nav-label">Live Portal</span></a>
            </SideTip>
          </div>
          <div className="nav-group nav-group-bottom">
            {SECTIONS_BOTTOM.map((s) => item(compact, s.key, `/products/${product.id}/${s.key}`, s.label, <s.icon />, section === s.key))}
            <NotificationsButton compact={compact} productId={product.id} onOpenFeedback={(id) => go(`/products/${product.id}/feedback?item=${id}`)} />
          </div>
        </nav>
        {foot(compact)}
      </>
    ) : (
      <>
        {brand(inSidebar, compact)}
        {productSwitch(compact)}
        <nav className="nav" aria-label="後台導覽">
          <p id="nav-need-product" className="small muted nav-need" style={{ margin: '0 10px 6px' }}>{needProduct}</p>
          <div className="nav-group">
            {item(compact, 'products', '/products', 'Product', <IconProduct />, !onSettings)}
            {SECTIONS.filter((s) => s.key !== 'dashboard').map((s) => off(compact, s.label, <s.icon />))}
            {off(compact, 'Live Portal', <IconPortal />)}
          </div>
          <div className="nav-group nav-group-bottom">
            {SECTIONS_BOTTOM.map((s) => off(compact, s.label, <s.icon />))}
            {off(compact, 'Notification', <IconBell />)}
          </div>
        </nav>
        {foot(compact)}
      </>
    );
  };

  return (
    <Ctx.Provider value={{ product, products: list, reloadProducts: products.reload, setDirty }}>
      <div className="shell" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
        <aside id="admin-sidebar" className="sidebar">{nav(true)}</aside>
        <header className="topbar">
          <Button ref={menuBtnRef} variant="ghost" icon aria-label="開啟選單" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><IconMenu /></Button>
          <span className="screen-name">{product ? `${current} · ${product.name}` : onSettings ? 'Setting' : 'Product'}</span>
        </header>
        <div ref={sheetRef} className="mobile-sheet" data-open={menuOpen} role="dialog" aria-modal="true" aria-label="選單" hidden={!menuOpen}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button variant="ghost" icon aria-label="關閉選單" onClick={() => setMenuOpen(false)}><IconX /></Button></div>
          {/* NAV-06: the phone drawer is always the full menu, whatever the desktop preference */}
          {menuOpen ? nav(false) : null}
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

/** NAV-03: a tooltip for a sidebar entry, only while the sidebar is collapsed (its text is then hidden). */
function SideTip({ on, label, side = 'right', children }: { on: boolean; label: string; side?: 'right' | 'bottom'; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} sideOffset={6} collisionPadding={8} className="pointer-events-none">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** NAV-04: the product switcher of the collapsed sidebar: an icon entry that opens the same choices. */
function CompactProductSwitch({ product, list, onPick }: { product: ProductItem | null; list: ProductItem[]; onPick: (id: string) => void }) {
  const label = product ? `目前產品：${product.name}（切換產品）` : list.length ? '尚未選取產品（選取產品）' : '尚無產品';
  return (
    <div className="product-switch product-switch-compact">
      <DropdownMenu modal={false}>
        <SideTip on label={label}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="product-switch-icon" aria-label={label}>
              <span aria-hidden="true" className="product-initial">{product ? [...product.name][0]?.toUpperCase() : <IconProduct />}</span>
              <ChevronsUpDownIcon aria-hidden="true" className="product-switch-chev" />
            </button>
          </DropdownMenuTrigger>
        </SideTip>
        <DropdownMenuContent side="right" align="start" collisionPadding={8} className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">目前產品</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {list.length ? (
            <DropdownMenuRadioGroup value={product?.id ?? ''} onValueChange={(id) => { if (id && id !== product?.id) onPick(id); }}>
              {list.map((p) => <DropdownMenuRadioItem key={p.id} value={p.id}>{p.name}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          ) : <DropdownMenuItem disabled>尚無產品</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Replaces the page with Login (no history entry for the page that needed a session). */
function ToLogin() {
  useEffect(() => {
    window.location.replace(loginHref(window.location.pathname + window.location.search));
  }, []);
  return <LoadingState label="正在前往登入頁…" />;
}

// extra props and the ref are passed on to the link, so a Tooltip trigger (asChild) can wrap it (NAV-03)
function NavLink({ href, active, children, icon, onNavigate, className = 'nav-item', label, onClick, ...rest }: { href: string; active: boolean; children: ReactNode; icon?: ReactNode; onNavigate: (href: string) => void; className?: string; label?: string } & Omit<ComponentPropsWithRef<'a'>, 'href' | 'className' | 'children'>) {
  return (
    <a {...rest} className={className} href={href} aria-label={label} aria-current={active ? 'page' : undefined} onClick={(e) => {
      onClick?.(e);
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      onNavigate(href);
    }}>{icon}{children}</a>
  );
}

const REASON_TEXT: Record<string, string> = { assigned: '指派你為負責人', comment: '在你建立的 Feedback 留言' };

interface NotificationItem { id: string; reasons: string[]; feedback: { id: string; title: string }; actor: { id: string; displayName: string; avatarUrl: string | null } | null; createdAt: string; readAt: string | null }

export function NotificationsButton({ productId, onOpenFeedback, basePath = `/products/${productId}`, compact = false }: { productId: string; onOpenFeedback: (feedbackId: string) => void; basePath?: string; compact?: boolean }) {
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
      <SideTip on={compact && !open} label={unread > 0 ? `Notification（${unread} 則未讀）` : 'Notification'}>
        <button ref={triggerRef} type="button" className="nav-item" aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen((o) => !o); void res.reload(); }}>
          <IconBell /><span className="nav-label">Notification</span>{unread > 0 ? <span className="nav-badge num" aria-label={`${unread} 則未讀`}>{unread}</span> : null}
        </button>
      </SideTip>
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
