'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/client/api';
import { loginHref, useSite } from '@/client/site';
import { Button, LoadingState } from '@/components/ui';
import { Logo } from '@/components/icons';

export function InviteScreen() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const { site, me, meLoaded, reloadMe } = useSite();
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const here = `/invite?token=${encodeURIComponent(token)}`;
  const accept = async () => {
    setState('pending');
    try {
      const r = await api.post('/invitations/accept', { body: { token } });
      await reloadMe();
      setState('done');
      setMessage(r.data.alreadyAccepted ? '你已接受過此邀請。' : '已加入！');
    } catch (e) {
      setState('error');
      setMessage(errorMessage(e));
    }
  };
  return (
    <main id="main" tabIndex={-1} className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ padding: 0 }}><Logo /><span>Chainseabase</span></div>
        <h1>接受邀請</h1>
        {!token ? <div className="banner banner-error">邀請連結缺少識別碼。</div> : null}
        {!meLoaded ? <LoadingState /> : !me ? (
          <>
            <p className="muted">請使用收到邀請的 Email 對應的 Google 帳號登入。</p>
            <a className="btn btn-primary" href={loginHref(here)}>登入後接受邀請</a>
          </>
        ) : state === 'done' ? (
          <>
            <div className="banner banner-success" role="status">{message}</div>
            <a className="btn btn-primary" href={site.site === 'admin' ? '/products' : '/'}>前往{site.site === 'admin' ? '後台' : '回饋網站'}</a>
          </>
        ) : (
          <>
            <p>目前登入：{me.displayName}（{me.email}）</p>
            {state === 'error' ? <div className="banner banner-error" role="alert">{message}</div> : null}
            <Button variant="primary" pending={state === 'pending'} disabled={!token} onClick={accept}>接受邀請</Button>
          </>
        )}
      </div>
    </main>
  );
}
