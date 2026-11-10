'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Me {
  id: string; displayName: string; email: string; avatarUrl: string | null; hasCustomAvatar: boolean;
  role: 'team' | 'tester' | 'none'; revision: number; interactiveProducts: { id: string; name: string; slug: string }[];
}

export interface SiteInfo {
  site: 'admin' | 'portal';
  adminOrigin: string;
  portalOrigin: string;
  googleLoginConfigured: boolean;
  testLogin: boolean;
  providers: { calendar: 'real' | 'fake'; email: 'real' | 'fake'; storage: 'real' | 'fake' };
  /** NAV-02: the desktop sidebar's remembered state (a cookie, read on the server so the first render matches) */
  sidebarCollapsed?: boolean;
}

/** meError: /me itself failed (network or server), so "not signed in" is not known: never redirect to login on it */
interface Ctx { site: SiteInfo; me: Me | null; meLoaded: boolean; meError: boolean; reloadMe: () => Promise<void> }
const SiteCtx = createContext<Ctx | null>(null);

export function SiteProvider({ initial, children }: { initial: SiteInfo; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setLoaded] = useState(false);
  const [meError, setMeError] = useState(false);
  const reloadMe = useCallback(async () => {
    try {
      const r = await api.get<Me | null>('/me');
      setMe(r.data);
      setMeError(false);
    } catch {
      setMe(null);
      setMeError(true);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void reloadMe(); }, [reloadMe]);
  return <SiteCtx.Provider value={{ site: initial, me, meLoaded, meError, reloadMe }}>{children}</SiteCtx.Provider>;
}

export function useSite() {
  const c = useContext(SiteCtx);
  if (!c) throw new Error('SiteProvider missing');
  return c;
}

export function loginHref(returnTo: string) {
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}
