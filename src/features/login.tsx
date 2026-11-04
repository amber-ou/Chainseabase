'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { api, errorMessage } from '@/client/api';
import { useSite } from '@/client/site';
import { Button as LegacyButton, Field } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand';

const ERRORS: Record<string, string> = {
  denied: '你取消了 Google 登入。',
  state: '登入流程已過期或驗證失敗，請重新登入。',
  unverified: '此 Google 帳號的 Email 尚未驗證，無法登入。',
  failed: 'Google 登入失敗，請稍後再試。',
};

/**
 * Login for both sites (admin: 登入團隊後台, portal: 登入回饋網站). Phase 5 layout
 * (docs/change-requests/sidebar-position.md, Login 版面調整): full window, the sign-in half on the
 * left and a neutral blank half on the right on wide screens; one column at 1024px and below.
 * Google OAuth, returnTo and every permission check are unchanged: the button is the same link.
 */
export function LoginScreen() {
  const params = useSearchParams();
  const { site, me, meLoaded } = useSite();
  const returnTo = params.get('returnTo') ?? (site.site === 'admin' ? '/products' : '/');
  const err = params.get('error');
  const href = `/api/v1/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
  // leaving for Google: one click only; reset when the browser brings the page back (Back button)
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const back = (e: PageTransitionEvent) => { if (e.persisted) setLeaving(false); };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);
  return (
    <main id="main" tabIndex={-1} className="login-split">
      <section className="login-pane" aria-labelledby="login-title">
        <div className="brand login-brand"><BrandMark size={28} /><span>Chainseabase</span></div>
        <div className="login-content">
          <h1 id="login-title">{site.site === 'admin' ? '登入團隊後台' : '登入回饋網站'}</h1>
          <p className="muted">使用 Google 帳號登入。登入本身不代表已加入團隊或受邀產品；互動權限由邀請決定。</p>
          {err ? (
            <div className="banner banner-error" role="alert">
              <span>{ERRORS[err] ?? ERRORS.failed}可以再按一次「使用 Google 登入」重試。</span>
            </div>
          ) : null}
          {meLoaded && me ? <div className="banner banner-info">目前已登入：{me.displayName}（{me.email}）</div> : null}
          {site.googleLoginConfigured ? (
            <Button asChild size="lg" className="w-full no-underline aria-busy:cursor-progress aria-busy:opacity-80">
              <a href={href} aria-disabled={leaving || undefined} aria-busy={leaving || undefined}
                onClick={(e) => { if (leaving) { e.preventDefault(); return; } setLeaving(true); }}>
                {leaving ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : null}
                {leaving ? '正在前往 Google…' : '使用 Google 登入'}
              </a>
            </Button>
          ) : (
            <div className="banner" role="note">Google 登入尚未設定：部署者需設定 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET。</div>
          )}
          {site.testLogin ? <TestLogin returnTo={returnTo} /> : null}
        </div>
      </section>
      {/* reserved for a later image (left blank on purpose): no picture, placeholder or text */}
      <div className="login-aside" aria-hidden="true" />
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
      <LegacyButton type="submit" pending={pending}>測試登入</LegacyButton>
    </form>
  );
}
