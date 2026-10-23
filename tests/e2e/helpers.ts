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
