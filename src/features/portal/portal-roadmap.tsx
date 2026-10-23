'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useResource } from '@/client/hooks';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { Board } from '@/features/roadmap/board';
import { usePortalProduct } from './portal-shell';
import type { PublicFeedback } from './portal-feedback';

interface PublicBoard { roadmap: { id: string; name: string; description: string }; columns: { id: string; label: string; count: number; cards: PublicFeedback[] }[] }

export function PortalRoadmapPage() {
  const { product } = usePortalProduct();
  const router = useRouter();
  const list = useResource<{ id: string; name: string; description: string }[]>(`/public/products/${product.slug}/roadmaps`);
  const [sel, setSel] = useState<string | null>(null);
  const current = sel ?? list.data?.[0]?.id ?? null;
  const board = useResource<PublicBoard>(current ? `/public/products/${product.slug}/roadmaps/${current}` : null);
  return (
    <>
      <div className="page-head"><div><h1>Roadmap</h1><p className="sub">公開的處理進度。只顯示公開的回饋，看板為唯讀。</p></div></div>
      {list.loading ? <LoadingState /> : list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : (list.data ?? []).length === 0 ? (
        <EmptyState title="尚未發布 Roadmap" />
      ) : (
        <Tabs label="Roadmap" value={current!} onChange={setSel} tabs={(list.data ?? []).map((r) => ({ id: r.id, label: r.name }))}>
          {board.loading ? <LoadingState /> : board.error ? <ErrorState message={board.error.message} onRetry={board.reload} /> : (
            <>
              {board.data!.roadmap.description ? <p className="muted" style={{ marginBottom: 12 }}>{board.data!.roadmap.description}</p> : null}
              <Board readOnly accent="roadmap" columns={board.data!.columns.map((c) => ({ id: c.id, label: c.label, title: c.label, count: c.count, cards: c.cards }))}
                onOpen={(id) => router.push(`/p/${product.slug}/feedback?item=${id}`)} />
            </>
          )}
        </Tabs>
      )}
    </>
  );
}
