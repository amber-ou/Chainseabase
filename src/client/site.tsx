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
}

interface Ctx { site: SiteInfo; me: Me | null; meLoaded: boolean; reloadMe: () => Promise<void> }
const SiteCtx = createContext<Ctx | null>(null);

export function SiteProvider({ initial, children }: { initial: SiteInfo; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [meLoaded, setLoaded] = useState(false);
  const reloadMe = useCallback(async () => {
    try {
      const r = await api.get<Me | null>('/me');
      setMe(r.data);
    } catch {
      setMe(null);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void reloadMe(); }, [reloadMe]);
  return <SiteCtx.Provider value={{ site: initial, me, meLoaded, reloadMe }}>{children}</SiteCtx.Provider>;
}

export function useSite() {
  const c = useContext(SiteCtx);
  if (!c) throw new Error('SiteProvider missing');
  return c;
}

export function loginHref(returnTo: string) {
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}
