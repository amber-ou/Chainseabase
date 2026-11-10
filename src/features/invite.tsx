'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '@/client/api';
import { loginHref, useSite } from '@/client/site';
import { Button, LoadingState } from '@/components/ui';
import { BrandMark } from '@/components/brand';

export function InviteScreen() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const { site, me, meLoaded, reloadMe } = useSite();
  // 'invalid': the invitation can no longer be accepted (revoked, expired, used, or its products deleted)
  const [state, setState] = useState<'checking' | 'idle' | 'pending' | 'done' | 'error' | 'invalid'>('checking');
  const [message, setMessage] = useState('');
  const here = `/invite?token=${encodeURIComponent(token)}`;
  const signedIn = Boolean(me);
  // checked as soon as the link opens (after sign-in), without consuming it
  useEffect(() => {
    if (!signedIn || !token) return;
    let live = true;
    api.post('/invitations/inspect', { body: { token } }).then((r) => {
      if (!live) return;
      if (r.data.valid) setState('idle');
      else { setState(r.data.alreadyAccepted ? 'done' : 'invalid'); setMessage(r.data.message ?? '邀請已失效。'); }
    }).catch(() => { if (live) setState('idle'); });
    return () => { live = false; };
  }, [signedIn, token]);
  const accept = async () => {
    setState('pending');
    try {
      const r = await api.post('/invitations/accept', { body: { token } });
      await reloadMe();
      setState('done');
      setMessage(r.data.alreadyAccepted ? '你已接受過此邀請。' : '已加入！');
    } catch (e) {
      // became invalid since the page opened (for example its product was just deleted)
      setState(e instanceof ApiError && e.code === 'INVITATION_INVALID' ? 'invalid' : 'error');
      setMessage(errorMessage(e));
    }
  };
  return (
    <main id="main" tabIndex={-1} className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ padding: 0 }}><BrandMark /><span>Chainseabase</span></div>
        <h1>接受邀請</h1>
        {!token ? <div className="banner banner-error">邀請連結缺少識別碼。</div> : null}
        {!meLoaded ? <LoadingState /> : !me ? (
          <>
            <p className="muted">請使用收到邀請的 Email 對應的 Google 帳號登入。</p>
            <a className="btn btn-primary" href={loginHref(here)}>登入後接受邀請</a>
          </>
        ) : state === 'invalid' ? (
          <>
            <h2 style={{ margin: 0 }}>邀請已失效</h2>
            <div className="banner banner-error" role="alert">{message}</div>
            <a className="btn" href={site.site === 'admin' ? '/products' : '/'}>前往{site.site === 'admin' ? '後台' : '回饋網站'}</a>
          </>
        ) : state === 'checking' && token ? (
          <LoadingState label="正在確認邀請…" />
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
