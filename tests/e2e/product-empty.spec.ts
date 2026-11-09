import { test, expect, type Page } from '@playwright/test';
import { ADMIN, expectNoAxeViolations, expectNoPageOverflow, listProducts, login } from './helpers';

/**
 * Deleting every product, including the initial 產品1 (docs/change-requests/sidebar-position.md,
 * phase 4). Destructive for the E2E database, so it runs in its own project after all the others
 * (playwright.config.ts); the database is rebuilt at the start of every E2E run.
 */
const SIZES = [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }];
const dialog = (page: Page) => page.getByRole('alertdialog', { name: /^永久刪除產品『/ });

test('every product can be deleted; Product shows 尚無產品 and 新增產品; nothing asks for a product', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  // every product but one through the API (as another member could), the last one through the UI
  let products = await listProducts(page);
  const last = products.find((p) => p.name === '產品1') ?? products[0];
  for (const p of products.filter((x) => x.id !== last.id)) {
    const r = await page.request.delete(`${ADMIN}/api/v1/products/${p.id}`, { headers: { origin: ADMIN, 'if-match': `"${p.revision}"` }, data: { confirmName: p.name } });
    expect(r.status(), p.name).toBe(200);
  }
  await page.goto(`${ADMIN}/products/${last.id}/dashboard`);
  await page.getByRole('list', { name: '產品' }).getByRole('button', { name: `${last.name} 的操作`, exact: true }).click();
  await page.getByRole('menuitem', { name: '刪除產品' }).click();
  await dialog(page).getByLabel('輸入產品名稱以確認').fill(last.name);
  const requests: string[] = [];
  page.on('request', (r) => { if (/\/api\/v1\/products\/[0-9a-f-]{36}/.test(r.url())) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await dialog(page).getByRole('button', { name: '永久刪除' }).click();

  await expect(page).toHaveURL(`${ADMIN}/products`);
  const empty = page.getByRole('heading', { name: '尚無產品' });
  await expect(empty).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: '新增產品', exact: true })).toHaveCount(1);
  await expect(page.getByRole('list', { name: '產品' })).toHaveCount(0);
  products = await listProducts(page);
  expect(products).toEqual([]);

  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.goto(`${ADMIN}/products`);
    await expect(empty).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: '新增產品', exact: true })).toBeVisible();
    const phone = size.width <= 1024;
    if (phone) await page.getByRole('button', { name: '開啟選單' }).click();
    const nav = (phone ? page.getByRole('dialog', { name: '選單' }) : page.locator('aside.sidebar')).getByRole('navigation', { name: '後台導覽' });
    await expect(nav.getByText('請先在 Product 新增產品')).toBeVisible();
    await expect(nav.locator('.nav-item').filter({ has: page.getByText('Calendar', { exact: true }) })).toHaveAttribute('aria-disabled', 'true');
    await expect(nav.getByRole('link')).toHaveText(['Product']);
    await expectNoPageOverflow(page);
    await page.screenshot({ path: test.info().outputPath(`empty-${size.width}.png`), fullPage: true });
    await expectNoAxeViolations(page, `empty ${size.width}`);
    if (phone) await page.keyboard.press('Escape');
  }
  // the only product request after the deletion was the deletion itself
  await page.waitForLoadState('networkidle');
  expect(requests).toEqual([`DELETE /api/v1/products/${last.id}`]);

  // the deleted 產品1's old URL shows nothing of it
  await page.goto(`${ADMIN}/products/${last.id}/roadmaps`);
  await expect(page.getByText('找不到產品')).toBeVisible();

  // start again from the empty state: the new product opens and is selected
  await page.goto(`${ADMIN}/products`);
  await page.getByRole('main').getByRole('button', { name: '新增產品', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增產品' });
  await expect(create).toContainText('產品可從清單的「⋯」選單重新命名或永久刪除。');
  await expect(create).not.toContainText('不提供封存或刪除');
  await create.getByLabel('產品名稱').fill('重新開始');
  await create.getByRole('button', { name: '建立產品' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\/dashboard$/);
  await expect(page.getByRole('list', { name: '產品' }).getByRole('link', { name: /^重新開始/ })).toHaveAttribute('aria-current', 'true');
});
