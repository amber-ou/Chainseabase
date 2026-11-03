import { expect, type Page } from '@playwright/test';

export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const ADMIN = `http://127.0.0.1:${PORT}`;
export const PORTAL = `http://localhost:${PORT}`;

/** Test-only login form (E2E_TEST_LOGIN); the server refuses it in production. */
export async function login(page: Page, site: 'admin' | 'portal', email: string, name = email.split('@')[0], returnTo = site === 'admin' ? '/products' : '/') {
  const origin = site === 'admin' ? ADMIN : PORTAL;
  await page.goto(`${origin}/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('名稱').fill(name);
  await page.getByRole('button', { name: '測試登入' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await expect(page.locator('body')).not.toContainText('測試登入（僅開發');
}

export async function openFirstProduct(page: Page, section = 'dashboard') {
  await page.goto(`${ADMIN}/products`);
  await page.waitForURL(/\/products\/[0-9a-f-]{36}\/dashboard/);
  const url = page.url().replace(/\/dashboard.*/, '');
  if (section !== 'dashboard') await page.goto(`${url}/${section}`);
  return url;
}

export function unique(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** No whole-page horizontal overflow (boards/tables scroll inside their own containers). */
export async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Short description of the focused element (tag, role, accessible name). */
export function focused(page: Page) {
  return page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return 'body';
    const label = (e as HTMLInputElement).labels?.[0]?.textContent;
    const name = (e.getAttribute('aria-label') ?? label ?? e.innerText ?? '').trim().replace(/\s+/g, ' ');
    return `${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[${e.getAttribute('role')}]` : ''} ${name}`.trim();
  });
}

export async function tabTo(page: Page, name: RegExp, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (name.test(await focused(page))) return;
  }
  throw new Error(`Tab never reached ${name}`);
}

/** axe-core WCAG 2.1 A/AA rules on the current page (same rule set as a11y.spec.ts). */
export async function expectNoAxeViolations(page: Page, label: string) {
  const { createRequire } = await import('node:module');
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') });
  const result = await page.evaluate(async () => {
    const r = await (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n: any) => n.target.join(' ')) }));
  });
  expect(result, `${label}: ${JSON.stringify(result, null, 2)}`).toEqual([]);
}

/** Create a product through the API (as the logged-in page) and return it. */
export async function createProduct(page: Page, name: string) {
  const r = await page.request.post(`${ADMIN}/api/v1/products`, { headers: { origin: ADMIN }, data: { name } });
  expect(r.status()).toBe(201);
  return (await r.json()).data as { id: string; name: string; slug: string; revision: number };
}

export async function listProducts(page: Page) {
  const r = await page.request.get(`${ADMIN}/api/v1/products`);
  return (await r.json()).data as { id: string; name: string; slug: string; revision: number }[];
}
