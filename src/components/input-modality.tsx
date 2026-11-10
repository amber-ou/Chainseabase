'use client';

import { useEffect } from 'react';

/**
 * Phase 3 III-01: tells CSS how the person is operating the page, so a mouse, pen or touch click does
 * not draw a focus ring while keyboard use always does (globals.css, html[data-input="pointer"]).
 *
 * - Starts as "keyboard": the first Tab of a fresh page shows its ring.
 * - A pointer press switches to "pointer"; Tab, Shift+Tab, F6 and the navigation keys (arrows, Home,
 *   End, Page Up/Down, Escape) switch back. Typing text after a click stays "pointer", so a clicked
 *   input does not suddenly grow a ring; arrows inside a text field do not count either.
 * - FB-01 (2026-11-10): typing with an input method (Chinese, Japanese, ...) sends composition key
 *   events — Escape to cancel a candidate, arrows and Enter to pick one — that were taken for keyboard
 *   navigation, so a clicked title or description suddenly showed a ring while typing. Composition
 *   events never count, and Escape inside a text field is typing (closing a dialog moves focus anyway).
 * - Nothing about focus itself changes: it only sets an attribute on <html>. Listeners are capture
 *   phase and passive, and are removed on unmount.
 */
const NAV_KEYS = new Set(['Tab', 'F6', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape']);

function isTextEntry(el: Element | null) {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type);
  return (el as HTMLElement).isContentEditable;
}

export function InputModality() {
  useEffect(() => {
    const root = document.documentElement;
    const set = (mode: 'keyboard' | 'pointer') => { if (root.dataset.input !== mode) root.dataset.input = mode; };
    set('keyboard');
    const onPointer = () => set('pointer');
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // an input method is composing text (keyCode 229 is how some browsers report it)
      if (e.isComposing || e.keyCode === 229) return;
      if (!NAV_KEYS.has(e.key)) return;
      // moving the caret (or Escape) inside a text field is typing, not navigating
      if (e.key !== 'Tab' && e.key !== 'F6' && isTextEntry(document.activeElement)) return;
      set('keyboard');
    };
    window.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointer, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
      delete root.dataset.input;
    };
  }, []);
  return null;
}
