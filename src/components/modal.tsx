'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui';
import { IconX } from './icons';

export const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog: labelled, focus moves in and is trapped, Escape closes,
 * focus returns to the opener on close.
 */
export function Modal({ title, onClose, children, footer, wide, labelledBy, closeLabel = '關閉', dismissable = true }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; labelledBy?: string; closeLabel?: string; dismissable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const saved = useRef(onClose);
  useEffect(() => { saved.current = onClose; }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelectorAll<HTMLElement>(FOCUSABLE)[1] ?? el;
    first.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) {
        // nested popovers handle Escape first (they stop propagation)
        e.preventDefault();
        saved.current();
      }
      if (e.key === 'Tab') {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
        if (items.length === 0) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    };
    el.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      el.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [dismissable]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && dismissable) saved.current(); }}>
      <div ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? titleId} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" icon aria-label={closeLabel} onClick={() => saved.current()}><IconX /></Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation with explicit consequence text; cancel is the safe default focus. */
export function ConfirmModal({ title, children, confirmLabel, onConfirm, onCancel, danger, pending, error }: {
  title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean; pending?: boolean; error?: string | null;
}) {
  return (
    <Modal title={title} onClose={onCancel} footer={<>
      <Button data-autofocus onClick={onCancel}>取消</Button>
      <Button variant={danger ? 'danger' : 'primary'} className={danger ? 'btn-solid' : ''} pending={pending} onClick={onConfirm}>{confirmLabel}</Button>
    </>}>
      <div>{children}</div>
      {error ? <div className="banner banner-error" role="alert">{error}</div> : null}
    </Modal>
  );
}
