/**
 * NAV-02: the desktop sidebar's collapse preference, kept in a cookie of this browser (no account data).
 * The root layout reads it on the server, so the first render already has the right width.
 * A plain module (not 'use client') so the server layout can import the name.
 */
export const SIDEBAR_COOKIE = 'csb_sidebar';

export function writeSidebarCookie(collapsed: boolean) {
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; SameSite=Lax`;
}
