'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { LoaderCircleIcon, PlusIcon } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/client/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/toast';
import { useProduct } from '@/features/admin/shell';
import { CalendarPanel } from '@/features/calendar/calendar';

export function DashboardPage() {
  const { product, products, reloadProducts } = useProduct();
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{product.name}</h1>
          <p className="sub">產品管理與 Google 共用日曆 · 網址代稱 <span className="mono">{product.slug}</span>（固定不變）</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={product.id} onValueChange={(id) => router.push(`/products/${id}/dashboard`)}>
            <SelectTrigger aria-label="切換產品" className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
          <NameDialog title="重新命名產品" initial={product.name} confirm="儲存名稱"
            trigger={<Button variant="outline">重新命名</Button>}
            onSubmit={async (name) => {
              await api.patch(`/products/${product.id}`, { body: { name, expectedRevision: product.revision } });
              await reloadProducts();
              toast('success', '已更新產品名稱');
            }} />
          <NameDialog title="新增產品" initial="" confirm="建立產品"
            hint="會自動建立預設狀態、類別、版本群組與預設看板；產品建立後不提供封存或刪除。"
            trigger={<Button variant="outline"><PlusIcon data-icon="inline-start" />新增產品</Button>}
            onSubmit={async (name) => {
              const r = await api.post('/products', { body: { name } });
              await reloadProducts();
              router.push(`/products/${r.data.id}/dashboard`);
            }} />
        </div>
      </div>
      <section className="section" aria-label="產品日曆">
        <div className="section-title"><h2>產品日曆</h2></div>
        <CalendarPanel productId={product.id} />
      </section>
    </>
  );
}

function NameDialog({ title, initial, confirm, hint, trigger, onSubmit }: {
  title: string; initial: string; confirm: string; hint?: string; trigger: ReactNode;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();
  const changeOpen = (next: boolean) => {
    if (next) { setName(initial); setError(null); }
    setOpen(next);
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{hint ?? '輸入產品名稱，網址代稱維持不變。'}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor={id}>產品名稱</FieldLabel>
            <Input id={id} maxLength={100} value={name} onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
            {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)}>取消</Button>
          <Button aria-disabled={pending || undefined} aria-busy={pending || undefined} onClick={async () => {
            if (pending) return;
            setPending(true);
            setError(null);
            try { await onSubmit(name); setOpen(false); }
            catch (e) { setError(e instanceof ApiError && e.status === 409 ? '名稱已被其他人更新，請重新開啟。' : errorMessage(e)); }
            finally { setPending(false); }
          }}>
            {pending ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : null}{confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
