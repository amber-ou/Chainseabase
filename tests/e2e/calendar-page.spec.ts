import { test, expect, type Page } from '@playwright/test';
import { ADMIN, login, openFirstProduct, unique } from './helpers';

/**
 * Calendar as its own page (docs/change-requests/sidebar-position.md, phase 3): the same panel moved
 * from Product, scoped to the selected product; old Product URLs still land on the right page.
 * Calendar operations themselves are covered by calendar.spec.ts (fake provider, not real Google).
 */
async function openNav(page: Page) {
  if (page.viewportSize()!.width <= 1024) {
    await page.getByRole('button', { name: '開啟選單' }).click();
    return page.getByRole('dialog', { name: '選單' });
  }
  return page.locator('aside.sidebar');
}

test('Calendar opens from the sidebar with the selected product; switching products keeps Calendar and its own binding', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page);
  // a product of its own, so it has no calendar binding whatever other tests bound to 產品1
  const created = await page.request.post(`${ADMIN}/api/v1/products`, { headers: { origin: ADMIN }, data: { name: unique('日曆範圍') } });
  expect(created.status()).toBe(201);
  const other = (await created.json()).data as { id: string; name: string };
  await page.reload();

  const nav = await openNav(page);
  await nav.getByRole('navigation', { name: '後台導覽' }).getByRole('link', { name: 'Calendar', exact: true }).click();
  await expect(page).toHaveURL(base + '/calendar');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Calendar');
  // CAL-01 (2026-11-10): no 「目前產品」 line under the title; the sidebar switcher names the product
  await expect(page.getByRole('main').getByText(/^目前產品：/)).toHaveCount(0);
  await expect(page.locator('aside.sidebar .product-switcher-name')).toHaveText('產品1');
  await expect(page.getByRole('heading', { name: '產品日曆' })).toBeVisible();
  await expect(page.getByText('開發模擬日曆')).toBeVisible(); // the moved panel (fake provider in E2E)
  await page.screenshot({ path: test.info().outputPath('calendar.png'), fullPage: true });

  // the sidebar switcher keeps the Calendar section and shows the other product's own state
  const nav2 = await openNav(page);
  await nav2.getByRole('button', { name: /^目前產品 / }).click();
  await page.getByRole('menuitemradio', { name: other.name, exact: true }).click();
  await expect(page).toHaveURL(`${ADMIN}/products/${other.id}/calendar`);
  await expect(page.locator('aside.sidebar .product-switcher-name')).toHaveText(other.name);
  // not connected or not bound yet: never the events of another product
  await expect(page.getByRole('button', { name: /連結模擬日曆/ }).or(page.getByRole('heading', { name: '綁定產品共用日曆' }))).toBeVisible();
  await expect(page.getByRole('tab', { name: '活動清單' })).toHaveCount(0);
});

test('old URLs: the product root opens Product; an old calendar return opens Calendar', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test');
  const base = await openFirstProduct(page);
  await page.goto(base);
  await expect(page).toHaveURL(base + '/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Product');
  // the Google Calendar consent used to return to the Product page with ?calendar=...
  await page.goto(base + '/dashboard?calendar=connected');
  await expect(page).toHaveURL(base + '/calendar?calendar=connected');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Calendar');
  // the product list itself is not redirected to Calendar
  await page.goto(base + '/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Product');
});
