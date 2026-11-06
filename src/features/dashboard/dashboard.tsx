'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { EllipsisIcon, LoaderCircleIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/client/api';
import { ymd } from '@/client/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Card } from '@/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { useToast } from '@/components/toast';
import { useProductList, writeLastProduct, type ProductItem } from '@/features/admin/shell';

// the product chosen from the list: the page remounts for the new product, and focus goes back to its row
let focusRowAfterSwitch: string | null = null;
// after deleting the selected product the list opens with nothing selected; focus starts on the list
let focusListAfterDelete = false;

/**
 * Product: the list of products. Selecting a row selects the product for every section (as the
 * sidebar switcher does). Works with no product selected and with no product at all.
 */
export function ProductListPage() {
  const { product, products, reloadProducts } = useProductList();
  const router = useRouter();
  const toast = useToast();
  // the row whose rename dialog is open (kept after closing so the dialog can close and return focus)
  const [rename, setRename] = useState<{ id: string; open: boolean } | null>(null);
  const target = rename ? products.find((p) => p.id === rename.id) : undefined;
  // the delete confirmation keeps the product as it was when the dialog opened (name and revision):
  // a change made since then makes the server refuse the deletion instead of deleting something else
  // (n: each opening starts a fresh dialog, with an empty field)
  const [remove, setRemove] = useState<{ target: ProductItem; open: boolean; n: number } | null>(null);
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLAnchorElement>());
  const createRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // set when a menu item opens a dialog: the dialog then takes focus instead of the menu button
  const toDialog = useRef(false);
  // where focus goes once the deleted row is gone from the list (the next row, or 新增產品 when none is left)
  const focusAfterDelete = useRef<{ deleted: string; next: string } | null>(null);
  const productId = product?.id ?? null;

  // the Google Calendar consent used to return here; the calendar now has its own page
  useEffect(() => {
    const query = window.location.search;
    if (productId && new URLSearchParams(query).has('calendar')) router.replace(`/products/${productId}/calendar${query}`);
  }, [productId, router]);
  useEffect(() => {
    if (!productId || focusRowAfterSwitch !== productId) return;
    focusRowAfterSwitch = null;
    rowRefs.current.get(productId)?.focus();
  }, [productId]);
  useEffect(() => {
    if (!focusListAfterDelete) return;
    focusListAfterDelete = false;
    headingRef.current?.focus();
  }, []);

  const deleted = async (p: ProductItem, gone: boolean) => {
    const message = gone ? `「${p.name}」已不存在，可能已被其他人刪除` : `已永久刪除「${p.name}」`;
    if (p.id === productId) {
      // the selected product is gone: clear the selection and open Product with nothing selected
      focusAfterDelete.current = { deleted: p.id, next: '' };
      writeLastProduct('');
      focusListAfterDelete = true;
      setRemove(null);
      toast(gone ? 'info' : 'success', message);
      router.replace('/products');
      return;
    }
    const index = products.findIndex((x) => x.id === p.id);
    // the next row (or the previous one); with no row left, the empty state's 新增產品
    focusAfterDelete.current = { deleted: p.id, next: (products[index + 1] ?? products[index - 1])?.id ?? 'create' };
    setRemove(null);
    await reloadProducts();
    toast(gone ? 'info' : 'success', message);
  };
  useEffect(() => {
    const f = focusAfterDelete.current;
    if (!f || remove || products.some((p) => p.id === f.deleted)) return;
    focusAfterDelete.current = null;
    if (f.next === 'create') createRef.current?.focus();
    else rowRefs.current.get(f.next)?.focus();
  }, [products, remove]);

  const create = (
    <NameDialog title="新增產品" description="會自動建立預設狀態、類別、版本群組與預設看板。產品可從清單的「⋯」選單重新命名或永久刪除。" initial="" confirm="建立產品"
      trigger={<Button ref={createRef}><PlusIcon data-icon="inline-start" />新增產品</Button>}
      onSubmit={async (name) => {
        const r = await api.post('/products', { body: { name } });
        await reloadProducts();
        router.push(`/products/${r.data.id}/dashboard`);
      }} />
  );

  return (
    // the shared page header, then the product cards
    <div className="flex flex-col">
      <div className="page-head">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="outline-none">Product</h1>
          <p className="sub">{products.length ? `${products.length} 個產品。點選卡片即切換目前產品，其他頁面會顯示該產品的資料。` : '尚未建立產品。'}</p>
        </div>
        {products.length ? create : null}
      </div>
      {!products.length ? (
        <Empty className="border border-dashed border-border bg-card">
          <EmptyHeader>
            <EmptyTitle role="heading" aria-level={2}>尚無產品</EmptyTitle>
            <EmptyDescription>新增產品後，才能使用 Calendar、Feedback、Roadmap 與其他依產品的功能。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{create}</EmptyContent>
        </Empty>
      ) : (
        // P01: one shadcn Card per product, as many columns as the width allows (one column on phones)
        <div className="flex flex-col gap-3">
          {!product ? (
            <p role="status" className="m-0 text-sm text-muted-foreground">尚未選取產品。請從清單選取產品，或新增產品。</p>
          ) : null}
          <ul aria-label="產品" className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
            {products.map((p) => {
              const current = p.id === productId;
              return (
                <li key={p.id} className="min-w-0">
                  <Card className={`group relative h-full gap-0 rounded-lg py-0 shadow-none transition-colors ${current ? 'border-[var(--primary)] bg-[var(--active)]/40' : 'hover:border-[var(--border-strong)] hover:bg-[var(--sunken)]'}`}>
                    {/* P04: the main area switches the product; the menu button is its sibling, never inside it */}
                    <Link ref={(el) => { if (el) rowRefs.current.set(p.id, el); else rowRefs.current.delete(p.id); }}
                      href={`/products/${p.id}/dashboard`} aria-current={current ? 'true' : undefined}
                      onClick={() => { if (!current) focusRowAfterSwitch = p.id; }}
                      className="flex min-h-24 min-w-0 flex-1 flex-col justify-between gap-3 rounded-lg py-4 pr-14 pl-4 text-foreground no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      <span className="min-w-0 truncate font-medium group-hover:underline">{p.name}</span>
                      {/* P02: name, creation date and the current marker; the portal address is not shown */}
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="text-sm text-muted-foreground">建立於 <span className="tabular-nums">{ymd(p.createdAt)}</span></span>
                        {current ? <Badge variant="outline" className="shrink-0 bg-background">目前產品</Badge> : null}
                      </span>
                    </Link>
                    <div className="absolute top-3 right-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button ref={(el) => { if (el) actionRefs.current.set(p.id, el); else actionRefs.current.delete(p.id); }}
                            variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground max-sm:size-11" aria-label={`${p.name} 的操作`}>
                            <EllipsisIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        {/* closing the menu returns focus to its button, unless a dialog is taking it */}
                        <DropdownMenuContent align="end" className="min-w-40" onCloseAutoFocus={(e) => { if (toDialog.current) { toDialog.current = false; e.preventDefault(); } }}>
                          <DropdownMenuItem onSelect={() => { toDialog.current = true; setRename({ id: p.id, open: true }); }}><PencilIcon />重新命名</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => { toDialog.current = true; setRemove((r) => ({ target: p, open: true, n: (r?.n ?? 0) + 1 })); }}><Trash2Icon />刪除產品</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
      {remove ? (
        <DeleteProductDialog key={`${remove.target.id}-${remove.n}`} target={remove.target} open={remove.open}
          onOpenChange={(o) => setRemove({ ...remove, open: o })}
          // after a deletion the row is going away: focus moves on with the list instead
          returnFocus={() => { if (!focusAfterDelete.current) actionRefs.current.get(remove.target.id)?.focus(); }}
          onDeleted={(gone) => deleted(remove.target, gone)} onStale={() => { void reloadProducts(); }} />
      ) : null}
    </div>
  );
}

/**
 * Permanent deletion, confirmed by typing the exact name. The server checks the name, the product and
 * the revision again. Pending: nothing can be submitted twice or closed. A result that cannot be read
 * (network or server error) is checked against the product list before anything is reported.
 */
function DeleteProductDialog({ target, open, onOpenChange, returnFocus, onDeleted, onStale }: {
  target: ProductItem; open: boolean; onOpenChange: (open: boolean) => void; returnFocus: () => void;
  onDeleted: (gone: boolean) => void | Promise<void>;
  /** the product changed since the dialog opened: refresh the list so a new confirmation uses it */
  onStale: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<'idle' | 'pending' | 'checking' | 'unknown'>('idle');
  const [error, setError] = useState<string | null>(null);
  // a refused confirmation (the product changed) cannot be retried from this dialog
  const [stale, setStale] = useState(false);
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = phase === 'pending' || phase === 'checking';
  const matches = typed === target.name;
  // after an unreadable result the action is to check again, never to assume either outcome
  const recheck = phase === 'unknown' || phase === 'checking';

  // a result we could not read: deleted only if the product is no longer in the list
  const verify = async () => {
    setPhase('checking');
    setError(null);
    try {
      const list = await api.get<{ id: string }[]>('/products');
      if (!list.data.some((p) => p.id === target.id)) { await onDeleted(false); return; }
      setPhase('idle');
      setError('未能確認刪除結果：產品仍在清單中，目前未刪除。可再按一次「永久刪除」重試。');
    } catch {
      setPhase('unknown');
      setError('無法確認產品是否已刪除，請檢查連線後按「重新檢查」。在確認之前，請不要假設已刪除。');
    }
  };
  const submit = async () => {
    if (busy || !matches || stale) return;
    setPhase('pending');
    setError(null);
    try {
      await api.del(`/products/${target.id}`, { ifMatch: target.revision, body: { confirmName: typed } });
      await onDeleted(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { await onDeleted(true); return; }
      if (e instanceof ApiError && e.status === 409) {
        setPhase('idle'); setStale(true); onStale();
        setError('此產品在開啟確認後已被更新（例如重新命名），這次確認已失效，產品未刪除。請關閉後重新開啟再確認。');
        return;
      }
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setPhase('idle');
        setError(e.status === 400 ? '輸入的名稱與產品名稱不一致，產品未刪除。' : `${errorMessage(e)}產品未刪除。`);
        return;
      }
      // network failure or server error: the deletion may or may not have happened
      await verify();
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <AlertDialogContent aria-busy={busy || undefined} className="gap-5"
        onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onCloseAutoFocus={(e) => { e.preventDefault(); returnFocus(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">永久刪除產品『{target.name}』？</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            此產品及其平台內所屬資料會永久刪除，無法在平台內復原。Google 上的日曆與活動不受影響。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* what goes, grouped in one quiet well; what stays, right under it */}
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex flex-col gap-2 rounded-md bg-muted px-4 py-3">
            <p className="m-0 font-medium">會一併刪除此產品在平台內的資料：</p>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
              <li>Feedback、留言、按讚、投票、Schedule 與 Roadmap 看板</li>
              <li>狀態、類別、標籤、人員標籤，以及每位成員在此產品的 Personal 檢視與私人標籤</li>
              <li>此產品的通知、測試成員的產品資格，以及邀請中的此產品</li>
              <li>平台內的 Google 日曆綁定與活動關聯</li>
            </ul>
          </div>
          <p className="m-0 text-muted-foreground">不會變更：其他產品、成員帳號、個人 Google 授權，以及 Google 上的日曆、活動與分享權限。</p>
        </div>
        <FieldGroup>
          <Field data-invalid={Boolean(error) && phase === 'idle' && !stale}>
            <FieldLabel htmlFor={id}>輸入產品名稱以確認</FieldLabel>
            <Input ref={inputRef} id={id} value={typed} readOnly={busy} autoComplete="off" spellCheck={false}
              onChange={(e) => setTyped(e.target.value)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} />
            <FieldDescription id={`${id}-hint`} className="break-words">需與「{target.name}」完全相同（含空白與大小寫）。</FieldDescription>
          </Field>
        </FieldGroup>
        {error ? <FieldError id={`${id}-error`} role="alert">{error}</FieldError> : null}
        <AlertDialogFooter>
          <AlertDialogCancel aria-disabled={busy || undefined} onClick={(e) => { if (busy) e.preventDefault(); }}>取消</AlertDialogCancel>
          {/* one button through every phase, so focus stays on it while the request runs */}
          <Button variant={recheck ? 'outline' : 'destructive'} disabled={!recheck && (!matches || stale)}
            aria-disabled={busy || undefined} aria-busy={busy || undefined}
            onClick={() => { if (busy) return; if (recheck) void verify(); else void submit(); }}>
            {busy ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : recheck ? null : <Trash2Icon data-icon="inline-start" />}
            {phase === 'pending' ? '刪除中…' : phase === 'checking' ? '確認結果中…' : recheck ? '重新檢查' : '永久刪除'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
      <DialogContent className="gap-6 sm:max-w-md" onCloseAutoFocus={returnFocus ? (e) => { e.preventDefault(); returnFocus(); } : undefined}>
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
