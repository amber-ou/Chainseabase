'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/client/api';
import { useSite } from '@/client/site';
import { Button, Field } from '@/components/ui';
import { Logo } from '@/components/icons';

const ERRORS: Record<string, string> = {
  denied: '你取消了 Google 登入。',
  state: '登入流程已過期或驗證失敗，請重新登入。',
  unverified: '此 Google 帳號的 Email 尚未驗證，無法登入。',
  failed: 'Google 登入失敗，請稍後再試。',
};

export function LoginScreen() {
  const params = useSearchParams();
  const { site, me, meLoaded } = useSite();
  const returnTo = params.get('returnTo') ?? (site.site === 'admin' ? '/products' : '/');
  const err = params.get('error');
  const href = `/api/v1/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <main id="main" className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ padding: 0 }}><Logo /><span>Chainseabase</span></div>
        <h1>{site.site === 'admin' ? '登入團隊後台' : '登入回饋網站'}</h1>
        <p className="muted">使用 Google 帳號登入。登入本身不代表已加入團隊或受邀產品；互動權限由邀請決定。</p>
        {err ? <div className="banner banner-error" role="alert">{ERRORS[err] ?? ERRORS.failed}</div> : null}
        {meLoaded && me ? <div className="banner banner-info">目前已登入：{me.displayName}（{me.email}）</div> : null}
        {site.googleLoginConfigured ? (
          <a className="btn btn-primary" href={href}>使用 Google 登入</a>
        ) : (
          <div className="banner" role="note">Google 登入尚未設定：部署者需設定 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET。</div>
        )}
        {site.testLogin ? <TestLogin returnTo={returnTo} /> : null}
      </div>
    </main>
  );
}

/** Development/E2E-only login. The server refuses it unless E2E_TEST_LOGIN=enabled outside production. */
function TestLogin({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="settings-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
          await api.post('/test-support/login', { body: { email, name: name || email, sub: `test-${email}` } });
          window.location.assign(returnTo);
        } catch (er) {
          setError(errorMessage(er));
          setPending(false);
        }
      }}
    >
      <strong>測試登入（僅開發／E2E 環境，非 Google）</strong>
      <Field label="Email">{(p) => <input {...p} className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Field label="名稱">{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      {error ? <div className="field-error" role="alert">{error}</div> : null}
      <Button type="submit" pending={pending}>測試登入</Button>
    </form>
  );
}
