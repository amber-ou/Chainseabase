'use client';

import { useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from '@/client/api';
import { useResource } from '@/client/hooks';
import { useSite } from '@/client/site';
import { Avatar, Button, ErrorState, Field, LoadingState } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Tabs } from '@/components/tabs';
import { MultiSelect } from '@/components/multiselect';
import { useToast } from '@/components/toast';
import { useProduct } from '@/features/admin/shell';
import type { Taxonomy } from '@/features/feedback/types';

export function SettingsPage() {
  const [tab, setTab] = useState('me');
  return (
    <>
      <div className="page-head"><div><h1>Setting</h1><p className="sub">管理個人資料、分類標籤與工作職掌。</p></div></div>
      <Tabs label="設定" value={tab} onChange={setTab} tabs={[{ id: 'me', label: '個人設定' }, { id: 'tags', label: '管理標籤' }, { id: 'people', label: '管理 Person tag' }]}>
        {tab === 'me' ? <PersonalSettings /> : tab === 'tags' ? <TagSettings /> : <PersonTagSettings />}
      </Tabs>
    </>
  );
}

function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section" aria-label={title}>
      <div><h2>{title}</h2><p className="muted" style={{ marginTop: 6 }}>{description}</p></div>
      <div className="settings-panel">{children}</div>
    </section>
  );
}

function PersonalSettings() {
  const { me, reloadMe, site } = useSite();
  const { product } = useProduct();
  const toast = useToast();
  const [name, setName] = useState(me?.displayName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [avatarState, setAvatarState] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  const tax = useResource<Taxonomy>(`/products/${product.id}/taxonomy`);
  const users = useResource<{ id: string; personTags: { id: string }[] }[]>(`/products/${product.id}/users`);
  const mine = users.data?.find((u) => u.id === me?.id)?.personTags.map((t) => t.id) ?? [];
  const [tagError, setTagError] = useState<string | null>(null);
  if (!me) return <LoadingState />;
  return (
    <>
      <Section title="名稱" description="顯示在留言、Schedule 與 Feedback 上。歷史操作的作者識別不會因改名而改變。">
        <Field label="顯示名稱" error={error}>{(p) => <input {...p} className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div><Button variant="primary" pending={pending} disabled={!name.trim() || name === me.displayName} onClick={async () => {
          setPending(true);
          setError(null);
          try { await api.patch('/me', { body: { displayName: name, expectedRevision: me.revision } }); await reloadMe(); toast('success', '已更新名稱'); } catch (e) { setError(errorMessage(e)); } finally { setPending(false); }
        }}>儲存名稱</Button></div>
      </Section>
      <Section title="頭像" description={<>接受 JPEG、PNG、WebP，最大 2 MB；伺服器會重新編碼並移除中繼資料。{site.providers.storage === 'fake' ? '（目前使用開發用暫存替身，尚未設定正式頭像目錄）' : ''}</>}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar name={me.displayName} url={me.avatarUrl} id={me.id} size={56} />
          <label className="btn">
            {avatarState.pending ? '上傳中…' : '選擇圖片'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) { setAvatarState({ pending: false, error: '頭像最大 2 MB。' }); return; }
              setAvatarState({ pending: true, error: null });
              try {
                await api.post('/me/avatar-upload', { rawBody: file, headers: { 'content-type': file.type } });
                await reloadMe();
                setAvatarState({ pending: false, error: null });
                toast('success', '已更新頭像');
              } catch (er) { setAvatarState({ pending: false, error: errorMessage(er) }); }
            }} />
          </label>
        </div>
        {avatarState.error ? <div className="field-error" role="alert">{avatarState.error}</div> : null}
      </Section>
      <Section title={`我在「${product.name}」的 Person tag`} description="決定 Personal 的負責清單與指派通知。選「未安排」代表沒有實際職掌。">
        {tax.data && users.data ? (
          <MultiSelect label="我的 Person tag" noneLabel="未安排" options={tax.data.personTags.map((t) => ({ id: t.id, label: t.name }))} value={mine} onChange={async (ids) => {
            setTagError(null);
            try {
              await api.put(`/products/${product.id}/users/${me.id}/person-tags`, { body: { personTagIds: ids, expectedRevision: tax.data!.productRevision } });
              await Promise.all([tax.reload(), users.reload()]);
            } catch (e) { setTagError(e instanceof ApiError && e.status === 409 ? '設定已被其他人更新，已重新載入。' : errorMessage(e)); await tax.reload(); }
          }} />
        ) : <LoadingState />}
        {tagError ? <div className="field-error" role="alert">{tagError}</div> : null}
      </Section>
    </>
  );
}

type Kind = 'statuses' | 'categories' | 'tags' | 'tag-groups' | 'person-tags';

interface DeleteTarget { kind: Kind; id: string; name: string; replacements: { id: string; name: string }[]; allowDetach: boolean; requiresReplacement?: boolean }

/** Delete flow: show the impact first, then migrate (replacement) or explicitly detach. */
function DeleteOptionModal({ target, revision, onClose, onDone }: { target: DeleteTarget; revision: number; onClose: () => void; onDone: () => void }) {
  const { product } = useProduct();
  const usage = useResource<{ feedbackCount: number; roadmaps: { name: string }[]; userCount?: number }>(
    target.kind === 'tag-groups' ? null : `/products/${product.id}/taxonomy/${target.kind}/${target.id}/usage`,
  );
  const [replacementId, setReplacementId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const used = (usage.data?.feedbackCount ?? 0) > 0 || (usage.data?.userCount ?? 0) > 0;
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await api.del(`/products/${product.id}/${target.kind}/${target.id}`, {
        body: { expectedRevision: revision, ...(replacementId ? { replacementId } : {}), ...(!replacementId && target.allowDetach ? { strategy: 'detach' } : {}) },
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 && e.code === 'REVISION_CONFLICT' ? '設定已被其他人更新，請關閉後重試。' : errorMessage(e));
    } finally { setPending(false); }
  };
  const needReplacement = target.requiresReplacement || (!target.allowDetach && used);
  return (
    <Modal title={`移除「${target.name}」`} onClose={onClose} footer={<>
      <Button data-autofocus onClick={onClose}>取消</Button>
      <Button variant="danger" className="btn-solid" pending={pending} disabled={needReplacement && !replacementId} onClick={submit}>{replacementId ? '遷移並移除' : '移除'}</Button>
    </>}>
      {usage.loading ? <LoadingState /> : (
        <div>
          {usage.data ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>使用中的 Feedback：{usage.data.feedbackCount} 筆</li>
              {usage.data.userCount !== undefined ? <li>持有此職掌的成員：{usage.data.userCount} 位</li> : null}
              <li>相關 Roadmap 欄位：{usage.data.roadmaps.length ? usage.data.roadmaps.map((r) => r.name).join('、') : '無'}</li>
            </ul>
          ) : <p>此群組的標籤與 Feedback 關聯會一併解除（被看板使用時無法移除）。</p>}
        </div>
      )}
      {target.replacements.length ? (
        <Field label={needReplacement ? '替代選項（必填）' : '替代選項（選填）'} hint={needReplacement ? '狀態與類別為必填，移除前需把引用遷移到其他選項。' : '不選擇時將解除這些 Feedback 的關聯。'}>{(p) => (
          <select {...p} className="select" value={replacementId} onChange={(e) => setReplacementId(e.target.value)}>
            <option value="">{needReplacement ? '請選擇' : '不遷移，直接解除關聯'}</option>
            {target.replacements.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}</Field>
      ) : null}
      <p className="small muted">遷移與看板欄位調整會在同一筆交易完成；對應的 Roadmap 欄位會一併移除，卡片依新值重新分欄。</p>
      {error ? <div className="banner banner-error" role="alert">{error}</div> : null}
    </Modal>
  );
}

function OptionList({ items, onRename, onDelete, extra }: { items: { id: string; name: string; isDefault?: boolean }[]; onRename: (id: string, name: string) => Promise<void>; onDelete: (id: string) => void; extra?: (id: string) => ReactNode }) {
  const [edit, setEdit] = useState<Record<string, string>>({});
  return (
    <div>
      {items.map((o) => (
        <div key={o.id} className="option-row">
          <label className="sr-only" htmlFor={`opt-${o.id}`}>名稱</label>
          <input id={`opt-${o.id}`} className="input name" maxLength={50} value={edit[o.id] ?? o.name} onChange={(e) => setEdit((s) => ({ ...s, [o.id]: e.target.value }))} />
          {o.isDefault ? <span className="chip">預設</span> : null}
          {extra?.(o.id)}
          {edit[o.id] !== undefined && edit[o.id] !== o.name ? <Button size="sm" onClick={async () => { await onRename(o.id, edit[o.id]); setEdit((s) => { const n = { ...s }; delete n[o.id]; return n; }); }}>儲存</Button> : null}
          <Button size="sm" variant="ghost" onClick={() => onDelete(o.id)}>移除</Button>
        </div>
      ))}
      {items.length === 0 ? <p className="muted small">尚無項目</p> : null}
    </div>
  );
}

function AddInline({ label, onAdd, children }: { label: string; onAdd: (name: string) => Promise<void>; children?: ReactNode }) {
  const [name, setName] = useState('');
  return (
    <form style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await onAdd(name.trim()); setName(''); }}>
      <label className="sr-only" htmlFor={`add-${label}`}>{label}</label>
      <input id={`add-${label}`} className="input" style={{ flex: '1 1 160px' }} maxLength={50} placeholder={label} value={name} onChange={(e) => setName(e.target.value)} />
      {children}
      <Button type="submit" size="sm" disabled={!name.trim()}>新增</Button>
    </form>
  );
}

function useTaxonomyMutations() {
  const { product } = useProduct();
  const tax = useResource<Taxonomy>(`/products/${product.id}/taxonomy`);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: (rev: number) => Promise<unknown>) => {
    if (!tax.data) return;
    setError(null);
    try { await fn(tax.data.productRevision); } catch (e) { setError(e instanceof ApiError && e.code === 'REVISION_CONFLICT' ? '設定已被其他人更新，已重新載入，請再試一次。' : errorMessage(e)); }
    await tax.reload();
  };
  return { tax, error, run, product };
}

function TagSettings() {
  const { tax, error, run, product } = useTaxonomyMutations();
  const [del, setDel] = useState<DeleteTarget | null>(null);
  const [newGroupMode, setNewGroupMode] = useState<'single' | 'multiple'>('single');
  if (tax.loading) return <LoadingState />;
  if (tax.error || !tax.data) return <ErrorState message={tax.error?.message} onRetry={tax.reload} />;
  const t = tax.data;
  const P = `/products/${product.id}`;
  return (
    <>
      {error ? <div className="banner banner-error" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}
      <Section title="狀態" description="每筆 Feedback 必有一個狀態；新增狀態會同步在所有狀態看板加欄。">
        <OptionList items={t.statuses}
          onRename={(id, name) => run((rev) => api.patch(`${P}/statuses/${id}`, { body: { name, expectedRevision: rev } }))}
          onDelete={(id) => setDel({ kind: 'statuses', id, name: t.statuses.find((s) => s.id === id)!.name, replacements: t.statuses.filter((s) => s.id !== id), allowDetach: false, requiresReplacement: t.statuses.find((s) => s.id === id)!.isDefault })}
          extra={(id) => !t.statuses.find((s) => s.id === id)!.isDefault ? <Button size="sm" variant="ghost" onClick={() => run((rev) => api.patch(`${P}/statuses/${id}`, { body: { isDefault: true, expectedRevision: rev } }))}>設為預設</Button> : null} />
        <AddInline label="新增狀態" onAdd={(name) => run((rev) => api.post(`${P}/statuses`, { body: { name, expectedRevision: rev } }))} />
      </Section>
      <Section title="類別" description="每筆 Feedback 必有一個類別。">
        <OptionList items={t.categories}
          onRename={(id, name) => run((rev) => api.patch(`${P}/categories/${id}`, { body: { name, expectedRevision: rev } }))}
          onDelete={(id) => setDel({ kind: 'categories', id, name: t.categories.find((s) => s.id === id)!.name, replacements: t.categories.filter((s) => s.id !== id), allowDetach: false, requiresReplacement: t.categories.find((s) => s.id === id)!.isDefault })}
          extra={(id) => !t.categories.find((s) => s.id === id)!.isDefault ? <Button size="sm" variant="ghost" onClick={() => run((rev) => api.patch(`${P}/categories/${id}`, { body: { isDefault: true, expectedRevision: rev } }))}>設為預設</Button> : null} />
        <AddInline label="新增類別" onAdd={(name) => run((rev) => api.post(`${P}/categories`, { body: { name, expectedRevision: rev } }))} />
      </Section>
      {t.tagGroups.map((g) => (
        <Section key={g.id} title={`群組：${g.name}`} description={g.systemKey === 'version' ? '系統版本群組：固定單選，與 Feedback 的版本欄位為同一份資料，不可移除。' : `${g.selectionMode === 'single' ? '單選' : '複選'}群組。單選群組可作為 Roadmap 分欄維度。`}>
          {g.systemKey !== 'version' ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="sr-only" htmlFor={`mode-${g.id}`}>選取模式</label>
              <select id={`mode-${g.id}`} className="select" style={{ width: 140 }} value={g.selectionMode} onChange={(e) => run((rev) => api.patch(`${P}/tag-groups/${g.id}`, { body: { selectionMode: e.target.value, expectedRevision: rev } }))}>
                <option value="single">單選</option>
                <option value="multiple">複選</option>
              </select>
              <Button size="sm" variant="ghost" onClick={() => setDel({ kind: 'tag-groups', id: g.id, name: g.name, replacements: [], allowDetach: true })}>移除群組</Button>
            </div>
          ) : null}
          <OptionList items={g.tags}
            onRename={(id, name) => run((rev) => api.patch(`${P}/tags/${id}`, { body: { name, expectedRevision: rev } }))}
            onDelete={(id) => setDel({ kind: 'tags', id, name: g.tags.find((x) => x.id === id)!.name, replacements: g.tags.filter((x) => x.id !== id), allowDetach: true })} />
          <AddInline label={`新增「${g.name}」標籤`} onAdd={(name) => run((rev) => api.post(`${P}/tags`, { body: { name, groupId: g.id, expectedRevision: rev } }))} />
        </Section>
      ))}
      <Section title="未分組標籤" description="不屬於任何群組，可任意多選。">
        <OptionList items={t.ungroupedTags}
          onRename={(id, name) => run((rev) => api.patch(`${P}/tags/${id}`, { body: { name, expectedRevision: rev } }))}
          onDelete={(id) => setDel({ kind: 'tags', id, name: t.ungroupedTags.find((x) => x.id === id)!.name, replacements: t.ungroupedTags.filter((x) => x.id !== id), allowDetach: true })} />
        <AddInline label="新增未分組標籤" onAdd={(name) => run((rev) => api.post(`${P}/tags`, { body: { name, groupId: null, expectedRevision: rev } }))} />
      </Section>
      <Section title="新增群組" description="群組決定單選或複選。複選群組改單選前需先處理衝突；被看板使用的單選群組不可改複選。">
        <AddInline label="群組名稱" onAdd={(name) => run((rev) => api.post(`${P}/tag-groups`, { body: { name, selectionMode: newGroupMode, expectedRevision: rev } }))}>
          <label className="sr-only" htmlFor="new-group-mode">選取模式</label>
          <select id="new-group-mode" className="select" style={{ width: 110 }} value={newGroupMode} onChange={(e) => setNewGroupMode(e.target.value as 'single' | 'multiple')}>
            <option value="single">單選</option>
            <option value="multiple">複選</option>
          </select>
        </AddInline>
      </Section>
      {del ? <DeleteOptionModal target={del} revision={t.productRevision} onClose={() => setDel(null)} onDone={() => { setDel(null); void tax.reload(); }} /> : null}
    </>
  );
}

function PersonTagSettings() {
  const { tax, error, run, product } = useTaxonomyMutations();
  const [del, setDel] = useState<DeleteTarget | null>(null);
  if (tax.loading) return <LoadingState />;
  if (tax.error || !tax.data) return <ErrorState message={tax.error?.message} onRetry={tax.reload} />;
  const t = tax.data;
  const P = `/products/${product.id}`;
  return (
    <>
      {error ? <div className="banner banner-error" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}
      <Section title="Person tag" description="工作職掌（例如 UIUX、前端、後端）。成員與 Feedback 都可多選；「未安排」是保留選項，代表沒有實際職掌，不會建立實體也不觸發通知。">
        <OptionList items={t.personTags}
          onRename={(id, name) => run((rev) => api.patch(`${P}/person-tags/${id}`, { body: { name, expectedRevision: rev } }))}
          onDelete={(id) => setDel({ kind: 'person-tags', id, name: t.personTags.find((x) => x.id === id)!.name, replacements: [], allowDetach: true })} />
        <AddInline label="新增 Person tag" onAdd={(name) => run((rev) => api.post(`${P}/person-tags`, { body: { name, expectedRevision: rev } }))} />
      </Section>
      {del ? <DeleteOptionModal target={del} revision={t.productRevision} onClose={() => setDel(null)} onDone={() => { setDel(null); void tax.reload(); }} /> : null}
    </>
  );
}
