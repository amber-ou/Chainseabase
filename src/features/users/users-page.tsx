'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError, errorMessage, newKey } from '@/client/api';
import { useResource } from '@/client/hooks';
import { useSite } from '@/client/site';
import { formatDateTime } from '@/client/format';
import { Avatar, Button, EmptyState, ErrorState, Field, LoadingState } from '@/components/ui';
import { ConfirmModal, Modal } from '@/components/modal';
import { MultiSelect } from '@/components/multiselect';
import { ActionMenu } from '@/components/menu';
import { useToast } from '@/components/toast';
import { useProduct } from '@/features/admin/shell';
import type { Taxonomy } from '@/features/feedback/types';

export interface ProductUser {
  id: string; displayName: string; email: string; role: 'team' | 'tester'; avatarUrl: string | null; revision: number;
  feedbackCount: number; personTags: { id: string; name: string }[]; testerProducts: { id: string; name: string }[];
}
interface Invitation { id: string; email: string; role: 'team' | 'tester'; status: string; products: { id: string; name: string }[]; expiresAt: string; createdAt: string; lastErrorCode: string | null; revision: number }

const INVITE_STATUS: Record<string, [string, string]> = {
  pending: ['寄送中', 'chip-warning'], sent: ['已寄出', ''], send_failed: ['寄送失敗', 'chip-negative'],
  accepted: ['已接受', 'chip-positive'], revoked: ['已撤銷', ''], expired: ['已過期', ''],
};

export function UsersPage() {
  const { product, products } = useProduct();
  const { me, site } = useSite();
  const toast = useToast();
  const users = useResource<ProductUser[]>(`/products/${product.id}/users`);
  const invites = useResource<Invitation[]>('/invitations');
  const tax = useResource<Taxonomy>(`/products/${product.id}/taxonomy`);
  const [inviting, setInviting] = useState(false);
  const [roleFor, setRoleFor] = useState<ProductUser | null>(null);
  const [tagsFor, setTagsFor] = useState<ProductUser | null>(null);
  const [removing, setRemoving] = useState<ProductUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inviteAction = async (inv: Invitation, action: 'resend' | 'revoke') => {
    setError(null);
    try {
      if (action === 'resend') await api.post(`/invitations/${inv.id}/resend`, { body: { expectedRevision: inv.revision } });
      else await api.del(`/invitations/${inv.id}`, { ifMatch: inv.revision });
      toast('success', action === 'resend' ? '已重新寄送，舊連結失效' : '已撤銷邀請');
    } catch (e) { setError(errorMessage(e)); }
    void invites.reload();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>User</h1>
          <p className="sub">哪些成員能使用「{product.name}」、負責什麼？列出所有團隊成員與此產品受邀的測試成員。</p>
        </div>
        <Button variant="primary" onClick={() => setInviting(true)}>Email 邀請</Button>
      </div>
      {site.providers.email === 'fake' ? <div className="banner" style={{ marginBottom: 12 }}>寄信服務目前為開發用模擬（未設定 Resend）：邀請會建立但不會真的寄出 Email。</div> : null}
      {error ? <div className="banner banner-error" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
      <section className="section" aria-label="成員">
        {users.loading ? <LoadingState /> : users.error ? <ErrorState message={users.error.message} onRetry={users.reload} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">成員</th><th scope="col">角色</th><th scope="col">Person tag</th><th scope="col" className="num">建立的 Feedback</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
              <tbody>
                {(users.data ?? []).map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/products/${product.id}/users/${u.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
                        <Avatar name={u.displayName} url={u.avatarUrl} id={u.id} size={32} />
                        <span style={{ display: 'flex', flexDirection: 'column' }}><strong>{u.displayName}{u.id === me?.id ? '（我）' : ''}</strong><span className="small muted">{u.email}</span></span>
                      </Link>
                    </td>
                    <td>{u.role === 'team' ? '團隊成員' : <>測試成員<div className="small muted">{u.testerProducts.map((p) => p.name).join('、')}</div></>}</td>
                    <td>{u.role === 'team' ? (u.personTags.length ? <div className="chips">{u.personTags.map((t) => <span key={t.id} className="chip">{t.name}</span>)}</div> : <span className="muted">未安排</span>) : <span className="muted">—</span>}</td>
                    <td className="num">{u.feedbackCount}</td>
                    <td style={{ textAlign: 'right' }}>
                      <ActionMenu label={`管理 ${u.displayName}`} items={[
                        ...(u.role === 'team' ? [{ label: '設定 Person tag', onSelect: () => setTagsFor(u) }] : []),
                        { label: '變更角色', onSelect: () => setRoleFor(u) },
                        { label: '移除成員', danger: true, onSelect: () => setRemoving(u) },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="section" aria-label="邀請">
        <div className="section-title"><h2>邀請紀錄</h2></div>
        {invites.loading ? <LoadingState /> : invites.error ? <ErrorState message={invites.error.message} onRetry={invites.reload} /> : (invites.data ?? []).length === 0 ? (
          <EmptyState title="尚未寄出邀請" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Email</th><th scope="col">角色／產品</th><th scope="col">狀態</th><th scope="col">到期</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
              <tbody>
                {(invites.data ?? []).map((inv) => {
                  const [label, cls] = INVITE_STATUS[inv.status] ?? [inv.status, ''];
                  const open = ['pending', 'sent', 'send_failed'].includes(inv.status);
                  return (
                    <tr key={inv.id}>
                      <td>{inv.email}</td>
                      <td>{inv.role === 'team' ? '團隊成員' : `測試成員：${inv.products.map((p) => p.name).join('、')}`}</td>
                      <td><span className={`chip ${cls}`}>{label}</span>{inv.lastErrorCode ? <div className="small muted">錯誤：{inv.lastErrorCode}</div> : null}</td>
                      <td className="small">{formatDateTime(inv.expiresAt)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {open || inv.status === 'expired' ? <Button size="sm" onClick={() => inviteAction(inv, 'resend')}>重寄</Button> : null}
                        {open ? <Button size="sm" variant="ghost" onClick={() => inviteAction(inv, 'revoke')}>撤銷</Button> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {inviting ? <InviteModal products={products} defaultProductId={product.id} onClose={() => setInviting(false)} onDone={() => { setInviting(false); void invites.reload(); toast('success', '已建立邀請'); }} /> : null}
      {roleFor ? <RoleModal user={roleFor} products={products} onClose={() => setRoleFor(null)} onDone={() => { setRoleFor(null); void users.reload(); }} /> : null}
      {tagsFor && tax.data ? <PersonTagsModal user={tagsFor} taxonomy={tax.data} onClose={() => setTagsFor(null)} onDone={() => { setTagsFor(null); void users.reload(); void tax.reload(); }} /> : null}
      {removing ? (
        <ConfirmModal title={`移除 ${removing.displayName}？`} confirmLabel="移除成員" danger onCancel={() => setRemoving(null)} onConfirm={async () => {
          try {
            await api.del(`/users/${removing.id}/membership`, { ifMatch: removing.revision });
            toast('success', '已移除成員');
            setRemoving(null);
            void users.reload();
          } catch (e) {
            setError(e instanceof ApiError && e.code === 'LAST_TEAM_MEMBER' ? '必須保留至少一位團隊成員。' : errorMessage(e));
            setRemoving(null);
          }
        }}>
          會撤銷所有產品的互動與後台權限、登出所有裝置並解除 Calendar 連線；已建立的 Feedback 與留言保留原作者。最後一位團隊成員無法移除。
        </ConfirmModal>
      ) : null}
    </>
  );
}

function InviteModal({ products, defaultProductId, onClose, onDone }: { products: { id: string; name: string }[]; defaultProductId: string; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'team' | 'tester'>('tester');
  const [productIds, setProductIds] = useState<string[]>([defaultProductId]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [key] = useState(newKey);
  const submit = async () => {
    setPending(true);
    setErrors({});
    try {
      await api.post('/invitations', { key, body: { email, role, productIds: role === 'team' ? [] : productIds } });
      onDone();
    } catch (e) {
      setErrors(e instanceof ApiError ? { ...e.body.fieldErrors, _: e.message } : { _: errorMessage(e) });
    } finally { setPending(false); }
  };
  return (
    <Modal title="Email 邀請" onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" pending={pending} onClick={submit}>寄出邀請</Button></>}>
      {errors._ ? <div className="banner banner-error" role="alert">{errors._}</div> : null}
      <Field label="Email" required error={errors.email} hint="受邀者需使用此 Email 的 Google 帳號接受；連結 7 天內有效、只能使用一次。">{(p) => (
        <input {...p} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus />
      )}</Field>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">角色</legend>
        <label className="ms-option"><input type="radio" name="role" checked={role === 'tester'} onChange={() => setRole('tester')} />測試成員（只能在受邀產品前台互動）</label>
        <label className="ms-option"><input type="radio" name="role" checked={role === 'team'} onChange={() => setRole('team')} />團隊成員（可管理所有產品）</label>
      </fieldset>
      {role === 'tester' ? (
        <Field label="受邀產品" required error={errors.productIds}>{(p) => (
          <MultiSelect id={p.id} label="受邀產品" options={products.map((x) => ({ id: x.id, label: x.name }))} value={productIds} onChange={setProductIds} />
        )}</Field>
      ) : null}
    </Modal>
  );
}

function RoleModal({ user, products, onClose, onDone }: { user: ProductUser; products: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<'team' | 'tester'>(user.role === 'team' ? 'tester' : 'team');
  const [productIds, setProductIds] = useState<string[]>(user.testerProducts.map((p) => p.id));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await api.patch(`/users/${user.id}/role`, { body: { role, testerProductIds: role === 'tester' ? productIds : undefined, expectedRevision: user.revision } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'LAST_TEAM_MEMBER' ? '必須保留至少一位團隊成員。' : errorMessage(e));
    } finally { setPending(false); }
  };
  return (
    <Modal title={`變更 ${user.displayName} 的角色`} onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" pending={pending} onClick={submit}>確認變更</Button></>}>
      {error ? <div className="banner banner-error" role="alert">{error}</div> : null}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">新角色</legend>
        <label className="ms-option"><input type="radio" name="newrole" checked={role === 'team'} onChange={() => setRole('team')} />團隊成員</label>
        <label className="ms-option"><input type="radio" name="newrole" checked={role === 'tester'} onChange={() => setRole('tester')} />測試成員</label>
      </fieldset>
      {role === 'tester' ? (
        <>
          <Field label="可互動的產品" hint="不會自動開放所有產品；未選擇時只能瀏覽公開內容。">{(p) => (
            <MultiSelect id={p.id} label="可互動的產品" options={products.map((x) => ({ id: x.id, label: x.name }))} value={productIds} onChange={setProductIds} />
          )}</Field>
          {user.role === 'team' ? <div className="banner small">降為測試成員會立即撤除 Person tag、後台登入與 Calendar 連線；私人 Personal 資料保留但無法存取。</div> : null}
        </>
      ) : null}
    </Modal>
  );
}

function PersonTagsModal({ user, taxonomy, onClose, onDone }: { user: ProductUser; taxonomy: Taxonomy; onClose: () => void; onDone: () => void }) {
  const { product } = useProduct();
  const [ids, setIds] = useState(user.personTags.map((t) => t.id));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Modal title={`${user.displayName} 在「${product.name}」的 Person tag`} onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" pending={pending} onClick={async () => {
      setPending(true);
      setError(null);
      try {
        await api.put(`/products/${product.id}/users/${user.id}/person-tags`, { body: { personTagIds: ids, expectedRevision: taxonomy.productRevision } });
        onDone();
      } catch (e) { setError(e instanceof ApiError && e.status === 409 ? '設定已被其他人更新，請關閉後重新開啟。' : errorMessage(e)); } finally { setPending(false); }
    }}>儲存</Button></>}>
      {error ? <div className="banner banner-error" role="alert">{error}</div> : null}
      <Field label="Person tag" hint="取得職掌不會追溯通知既有 Feedback，但 Personal 負責清單會立即更新。">{(p) => (
        <MultiSelect id={p.id} label="Person tag" noneLabel="未安排" options={taxonomy.personTags.map((t) => ({ id: t.id, label: t.name }))} value={ids} onChange={setIds} />
      )}</Field>
    </Modal>
  );
}
