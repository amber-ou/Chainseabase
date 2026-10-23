export const DISPLAY_TZ = 'Asia/Taipei';

const dateFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: DISPLAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: DISPLAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const timeFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: DISPLAY_TZ, hour: '2-digit', minute: '2-digit', hour12: false });

function parts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** YYYY-MM-DD in Asia/Taipei */
export function ymd(iso: string | Date): string {
  return parts(typeof iso === 'string' ? new Date(iso) : iso);
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : '';
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : '';
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 45) return '剛剛';
  if (diff < 3600) return `${Math.round(diff / 60)} 分鐘前`;
  if (diff < 86400) return `${Math.round(diff / 3600)} 小時前`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} 天前`;
  return formatDate(iso);
}

export const PRIORITY_LABEL: Record<string, string> = { P0: 'P0 非常重要', P1: 'P1 重要', P2: 'P2 一般', P3: 'P3 低' };
