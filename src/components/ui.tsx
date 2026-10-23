'use client';

import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { IconAlert, IconCheck, IconLock } from './icons';

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} />;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'default';
  size?: 'sm' | 'md';
  pending?: boolean;
  icon?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'default', size = 'md', pending, icon, className = '', children, disabled, ...rest }, ref,
) {
  const cls = ['btn', variant !== 'default' ? `btn-${variant}` : '', size === 'sm' ? 'btn-sm' : '', icon ? 'btn-icon' : '', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type="button" className={cls} disabled={disabled || pending} aria-busy={pending || undefined} {...rest}>
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
});

export function Field({ label, hint, error, children, id, required }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: (p: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode; id?: string; required?: boolean }) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={fid}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      {children({ id: fid, 'aria-invalid': error ? true : undefined, 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined })}
      {hint ? <span id={hintId} className="field-hint">{hint}</span> : null}
      {error ? <span id={errId} className="field-error" role="alert">{error}</span> : null}
    </div>
  );
}

const AVATAR_COLORS = ['#3d4a5c', '#5b4a3d', '#3d5b4f', '#4f3d5b', '#5b3d45', '#3d555b', '#4a4a4a'];
function hashColor(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({ name, url, size = 24, id }: { name: string; url?: string | null; size?: number; id?: string }) {
  const [broken, setBroken] = useState(false);
  const initial = [...(name || '?').trim()][0] ?? '?';
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.max(10, size * 0.45), background: url && !broken ? 'var(--raised)' : hashColor(id ?? name) }} aria-hidden="true">
      {/* small external/proxied avatars: next/image optimization is not needed here */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && !broken ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : initial}
    </span>
  );
}

export function LoadingState({ label = '載入中…' }: { label?: string }) {
  return <div className="state state-center" role="status" aria-live="polite"><Spinner /><span>{label}</span></div>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <span className="state-title">{title}</span>
      {children ? <span className="muted">{children}</span> : null}
      {action}
    </div>
  );
}

export function ErrorState({ title = '讀取失敗', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <span className="state-title" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><IconAlert />{title}</span>
      {message ? <span>{message}</span> : null}
      {onRetry ? <Button size="sm" onClick={onRetry}>重試</Button> : null}
    </div>
  );
}

export function DeniedState({ title = '沒有權限', message, action }: { title?: string; message?: string; action?: ReactNode }) {
  return (
    <div className="state state-denied" role="alert">
      <span className="state-title" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><IconLock />{title}</span>
      {message ? <span className="muted">{message}</span> : null}
      {action}
    </div>
  );
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Inline save indicator with an aria-live region (no toast spam). */
export function SaveStatus({ state, onRetry, errorText }: { state: SaveState; onRetry?: () => void; errorText?: string }) {
  return (
    <span className="save-status" data-state={state} aria-live="polite">
      {state === 'saving' ? <><Spinner />儲存中…</> : null}
      {state === 'saved' ? <><IconCheck />已儲存</> : null}
      {state === 'error' ? <><IconAlert />{errorText ?? '儲存失敗'}{onRetry ? <Button size="sm" variant="ghost" onClick={onRetry}>重試</Button> : null}</> : null}
    </span>
  );
}

/** Polite live region for drag/move/command announcements. */
export function useAnnouncer() {
  const [msg, setMsg] = useState('');
  const region = <div className="sr-only" aria-live="polite" aria-atomic="true">{msg}</div>;
  return { announce: (m: string) => { setMsg(''); setTimeout(() => setMsg(m), 30); }, region };
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-checked={checked} />
      <span>{label}</span>
    </label>
  );
}

/** Close on outside click / Escape for small popovers. */
export function useDismiss(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  const saved = useRef(onClose);
  useEffect(() => { saved.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) saved.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); saved.current(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, ref]);
}
