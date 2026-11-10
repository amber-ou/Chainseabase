import { expect, type Locator, type Page } from '@playwright/test';

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

/**
 * The brand mark is the original PNG, loaded, with its visible logo filling a `size` box: the image is
 * drawn larger so only its transparent margin extends past the box. No old SVG icon is left.
 */
export async function expectBrandMark(scope: Locator, size: number) {
  const mark = scope.locator('.brand-mark');
  await expect(mark).toHaveCount(1);
  await expect(scope.locator('svg')).toHaveCount(0);
  const img = mark.locator('img');
  await expect(img).toHaveAttribute('src', '/brand/chainsea-logo.png');
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBe(1800);
  const box = (await mark.boundingBox())!;
  expect(Math.round(box.width)).toBe(size);
  expect(Math.round(box.height)).toBe(size);
  // the visible logo (alpha box 352–1452 × 345–1453 of 1800) maps onto the mark box, centred
  const imgBox = (await img.boundingBox())!;
  const k = imgBox.width / 1800;
  const visible = { x: imgBox.x + 352 * k, y: imgBox.y + 345 * k, w: 1100 * k, h: 1108 * k };
  expect(Math.abs(visible.x + visible.w / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(0.5);
  expect(Math.abs(visible.y + visible.h / 2 - (box.y + box.height / 2))).toBeLessThanOrEqual(0.5);
  expect(Math.abs(Math.max(visible.w, visible.h) - size)).toBeLessThanOrEqual(0.5);
  // nothing visible is clipped by a container: the box's centre and corners show the image itself
  const hit = await mark.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 1, r.top + r.height / 2], [r.right - 1, r.top + r.height / 2]]
      .map(([x, y]) => document.elementsFromPoint(x, y).some((n) => n === el.querySelector('img') || n === el));
  });
  expect(hit).toEqual([true, true, true]);
}

/** The sidebar product switcher (2026-11-10 NAV-02): open it and pick a product by name. */
export async function switchProduct(page: Page, name: string, scope: Locator = page.locator('aside.sidebar')) {
  await scope.getByRole('button', { name: /^目前產品 / }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
}

/** The name the sidebar switcher shows for the current product (or its empty state). */
export function currentProductName(scope: Locator) {
  return scope.locator('.product-switcher-name');
}

/** From a Feedback detail (2026-11-10 DETAIL-02/03): ⋯ → 編輯, returning the shared form in edit mode. */
export async function openEdit(page: Page, detail: Locator) {
  await detail.getByRole('button', { name: 'Feedback 更多操作' }).click();
  await page.getByRole('menuitem', { name: '編輯' }).click();
  const form = page.getByRole('dialog', { name: '編輯 Feedback' });
  await expect(form).toBeVisible();
  return form;
}
