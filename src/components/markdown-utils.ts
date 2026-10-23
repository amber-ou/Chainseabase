/** Link protocol allowlist for user Markdown (no javascript:, data:, vbscript: …). */
export function safeHref(href: string | null | undefined): string {
  if (!href) return '';
  const v = href.trim();
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  return '';
}
