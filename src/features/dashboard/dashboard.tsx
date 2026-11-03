'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { EllipsisIcon, LoaderCircleIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/client/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { useToast } from '@/components/toast';
import { useProduct } from '@/features/admin/shell';

// the product chosen from the list: the page remounts for the new product, and focus goes back to its row
let focusRowAfterSwitch: string | null = null;

/** Product: the list of products. Selecting a row selects the product for every section (as the sidebar switcher does). */
export function ProductListPage() {
  const { product, products, reloadProducts } = useProduct();
  const router = useRouter();
  const toast = useToast();
  // the row whose rename dialog is open (kept after closing so the dialog can close and return focus)
  const [rename, setRename] = useState<{ id: string; open: boolean } | null>(null);
  const target = rename ? products.find((p) => p.id === rename.id) : undefined;
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLAnchorElement>());
  // set when 重新命名 is chosen: the dialog then takes focus instead of the menu button
  const toDialog = useRef(false);

  // the Google Calendar consent used to return here; the calendar now has its own page
  useEffect(() => {
    const query = window.location.search;
    if (new URLSearchParams(query).has('calendar')) router.replace(`/products/${product.id}/calendar${query}`);
  }, [product.id, router]);
  useEffect(() => {
    if (focusRowAfterSwitch !== product.id) return;
    focusRowAfterSwitch = null;
    rowRefs.current.get(product.id)?.focus();
  }, [product.id]);

  return (
    <>
      <div className="page-head">
        <h1>Product</h1>
        <NameDialog title="新增產品" description="會自動建立預設狀態、類別、版本群組與預設看板；產品建立後不提供封存或刪除。" initial="" confirm="建立產品"
          trigger={<Button variant="outline"><PlusIcon data-icon="inline-start" />新增產品</Button>}
          onSubmit={async (name) => {
            const r = await api.post('/products', { body: { name } });
            await reloadProducts();
            router.push(`/products/${r.data.id}/dashboard`);
          }} />
      </div>
      <ul aria-label="產品" className="m-0 flex list-none flex-col divide-y divide-border rounded-lg border border-border bg-card p-0">
        {products.map((p) => {
          const current = p.id === product.id;
          return (
            <li key={p.id} className={`flex items-center gap-2 pr-2 first:rounded-t-lg last:rounded-b-lg ${current ? 'bg-muted' : ''}`}>
              <Link ref={(el) => { if (el) rowRefs.current.set(p.id, el); else rowRefs.current.delete(p.id); }}
                href={`/products/${p.id}/dashboard`} aria-current={current ? 'true' : undefined}
                onClick={() => { if (!current) focusRowAfterSwitch = p.id; }}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-4 py-2 text-foreground no-underline outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <span className={`min-w-0 truncate ${current ? 'font-medium' : ''}`}>{p.name}</span>
                {current ? <Badge variant="secondary" className="shrink-0">目前產品</Badge> : null}
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button ref={(el) => { if (el) actionRefs.current.set(p.id, el); else actionRefs.current.delete(p.id); }}
                    variant="ghost" size="icon" className="shrink-0 max-sm:size-11" aria-label={`${p.name} 的操作`}>
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                {/* closing the menu returns focus to its button, unless the rename dialog is taking it */}
                <DropdownMenuContent align="end" onCloseAutoFocus={(e) => { if (toDialog.current) { toDialog.current = false; e.preventDefault(); } }}>
                  <DropdownMenuItem onSelect={() => { toDialog.current = true; setRename({ id: p.id, open: true }); }}><PencilIcon />重新命名</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
      {rename && target ? (
        <NameDialog key={target.id} open={rename.open} onOpenChange={(o) => setRename({ id: target.id, open: o })}
          returnFocus={() => actionRefs.current.get(target.id)?.focus()}
          title="重新命名產品" description={`目前名稱：${target.name}。網址代稱維持不變。`} initial={target.name} confirm="儲存"
          onSubmit={async (name) => {
            // the list's current revision: a rename made since opening is rejected (409), not overwritten
            await api.patch(`/products/${target.id}`, { body: { name, expectedRevision: target.revision } });
            await reloadProducts();
            toast('success', '已更新產品名稱');
          }} />
      ) : null}
    </>
  );
}

function NameDialog({ title, description, initial, confirm, trigger, open: controlled, onOpenChange, returnFocus, onSubmit }: {
  title: string; description: string; initial: string; confirm: string; trigger?: ReactNode;
  open?: boolean; onOpenChange?: (open: boolean) => void; returnFocus?: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();
  // every opening starts from the current name; while open, the input is the user's
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) { setName(initial); setError(null); }
    wasOpen.current = open;
  }, [open, initial]);
  const changeOpen = (next: boolean) => {
    setOwn(next);
    onOpenChange?.(next);
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent onCloseAutoFocus={returnFocus ? (e) => { e.preventDefault(); returnFocus(); } : undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
            try { await onSubmit(name); changeOpen(false); }
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
