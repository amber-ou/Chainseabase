import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="login-wrap">
      <div className="card login-card">
        <h1>找不到頁面</h1>
        <p className="muted">此網址不存在，或不屬於這個網站。</p>
        <Link className="btn" href="/">回到首頁</Link>
      </div>
    </main>
  );
}
