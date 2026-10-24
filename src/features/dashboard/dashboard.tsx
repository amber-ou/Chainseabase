'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, errorMessage } from '@/client/api';
import { Button, Field } from '@/components/ui';
import { Modal } from '@/components/modal';
import { IconPlus } from '@/components/icons';
import { useToast } from '@/components/toast';
import { useProduct } from '@/features/admin/shell';
import { CalendarPanel } from '@/features/calendar/calendar';

export function DashboardPage() {
  const { product, products, reloadProducts } = useProduct();
  const router = useRouter();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{product.name}</h1>
          <p className="sub">產品管理與 Google 共用日曆 · 網址代稱 <span className="mono">{product.slug}</span>（固定不變）</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="sr-only" htmlFor="dash-switch">切換產品</label>
          <select id="dash-switch" className="select" style={{ width: 180 }} value={product.id} onChange={(e) => router.push(`/products/${e.target.value}/dashboard`)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button onClick={() => setRenaming(true)}>重新命名</Button>
          <Button onClick={() => setCreating(true)}><IconPlus />新增產品</Button>
        </div>
      </div>
      <section className="section" aria-label="產品日曆">
        <div className="section-title"><h2>產品日曆</h2></div>
        <CalendarPanel productId={product.id} />
      </section>
      {renaming ? (
        <NameModal title="重新命名產品" initial={product.name} confirm="儲存名稱" onClose={() => setRenaming(false)} onSubmit={async (name) => {
          await api.patch(`/products/${product.id}`, { body: { name, expectedRevision: product.revision } });
          await reloadProducts();
          toast('success', '已更新產品名稱');
          setRenaming(false);
        }} />
      ) : null}
      {creating ? (
        <NameModal title="新增產品" initial="" confirm="建立產品" hint="會自動建立預設狀態、類別、版本群組與預設看板；產品建立後不提供封存或刪除。" onClose={() => setCreating(false)} onSubmit={async (name) => {
          const r = await api.post('/products', { body: { name } });
          await reloadProducts();
          setCreating(false);
          router.push(`/products/${r.data.id}/dashboard`);
        }} />
      ) : null}
    </>
  );
}

function NameModal({ title, initial, confirm, hint, onClose, onSubmit }: { title: string; initial: string; confirm: string; hint?: string; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" pending={pending} onClick={async () => {
      setPending(true);
      setError(null);
      try { await onSubmit(name); } catch (e) { setError(e instanceof ApiError && e.status === 409 ? '名稱已被其他人更新，請重新開啟。' : errorMessage(e)); } finally { setPending(false); }
    }}>{confirm}</Button></>}>
      <Field label="產品名稱" hint={hint} error={error}>{(p) => <input {...p} className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} data-autofocus />}</Field>
    </Modal>
  );
}
