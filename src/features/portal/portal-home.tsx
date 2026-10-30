'use client';

import { useResource } from '@/client/hooks';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { Logo } from '@/components/icons';
import { useSite } from '@/client/site';
import { PortalAccessState, PortalNotInvited, PortalUserBox } from './portal-shell';

export function PortalHome() {
  const res = useResource<{ id: string; name: string; slug: string }[]>('/public/products');
  const { me, meLoaded } = useSite();
  return (
    <>
      <header className="portal-top">
        <span className="brand" style={{ padding: 0 }}><Logo /><span>Chainseabase 回饋</span></span>
        <span style={{ marginLeft: 'auto' }}><PortalUserBox /></span>
      </header>
      <main id="main" tabIndex={-1} className="portal-main">
        <h1 style={{ marginBottom: 16 }}>產品</h1>
        {res.loading ? <LoadingState /> : res.error ? (res.error.status >= 500 ? <ErrorState message={res.error.message} onRetry={res.reload} /> : <PortalAccessState error={res.error} />) : (res.data ?? []).length === 0 ? (!meLoaded ? <LoadingState /> : me?.role === 'none' ? <PortalNotInvited /> : <EmptyState title="目前沒有你受邀的產品" />) : (
          <div className="list">
            {(res.data ?? []).map((p) => <a key={p.id} className="list-row" href={`/p/${p.slug}/feedback`}><span className="title">{p.name}</span><span className="meta">查看回饋與進度</span></a>)}
          </div>
        )}
      </main>
    </>
  );
}
