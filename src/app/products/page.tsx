'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useResource } from '@/client/hooks';
import { loginHref, useSite } from '@/client/site';
import { DeniedState, ErrorState, LoadingState } from '@/components/ui';

export default function ProductsIndex() {
  const { me, meLoaded, site } = useSite();
  const router = useRouter();
  const res = useResource<{ id: string }[]>(me?.role === 'team' ? '/products' : null);
  useEffect(() => {
    if (!res.data?.length) return;
    let last: string | null = null;
    try { last = localStorage.getItem('csb:lastProduct'); } catch { last = null; }
    const target = res.data.find((p) => p.id === last) ?? res.data[0];
    router.replace(`/products/${target.id}/dashboard`);
  }, [res.data, router]);
  if (!meLoaded) return <main id="main" tabIndex={-1} className="login-wrap"><LoadingState /></main>;
  if (!me) return <main id="main" tabIndex={-1} className="login-wrap"><DeniedState title="請先登入" message="後台需要團隊成員以 Google 登入。" action={<a className="btn btn-primary" href={loginHref('/products')}>前往登入</a>} /></main>;
  if (me.role !== 'team') return <main id="main" tabIndex={-1} className="login-wrap"><DeniedState title="沒有後台權限" message={`目前登入的 ${me.email} 不是團隊成員。`} action={<a className="btn" href={site.portalOrigin}>前往前台網站</a>} /></main>;
  if (res.error) return <main id="main" tabIndex={-1} className="login-wrap"><ErrorState message={res.error.message} onRetry={res.reload} /></main>;
  return <main id="main" tabIndex={-1} className="login-wrap"><LoadingState label="正在開啟產品…" /></main>;
}
