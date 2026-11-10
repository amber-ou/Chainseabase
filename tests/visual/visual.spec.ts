import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ADMIN, PORTAL, login, openFirstProduct } from '../e2e/helpers';

/**
 * Stable visual comparisons of pages whose look this pass fixed (UI stabilisation, 2026-11-09).
 * Fixed data: a product created here with fixed names; anything time-based (relative times, dates) and
 * the product name that carries a unique suffix are masked; animations and the caret are off.
 * Baselines are set only after the user approves the screens (see playwright.visual.config.ts).
 */
async function fixedProduct(page: Page) {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const r = await page.request.post(`${ADMIN}/api/v1/products`, { headers: { origin: ADMIN }, data: { name: `視覺比對 ${randomUUID().slice(0, 6)}` } });
  const product = (await r.json()).data as { id: string };
  for (const title of ['登入後首頁載入過慢', '匯出報表時欄位順序錯誤', '希望支援批次修改狀態']) {
    await page.request.post(`${ADMIN}/api/v1/products/${product.id}/feedback`, { headers: { origin: ADMIN, 'idempotency-key': randomUUID() }, data: { title } });
  }
  return product;
}
const masks = (page: Page) => [page.locator('#product-switch'), page.locator('.screen-name'), page.locator('.kcard-foot')];

test('Roadmap board', async ({ page }) => {
  const p = await fixedProduct(page);
  await page.goto(`${ADMIN}/products/${p.id}/roadmaps`);
  await expect(page.locator('.board-plain .kcard')).toHaveCount(3);
  await expect(page).toHaveScreenshot('roadmap.png', { mask: masks(page), fullPage: true });
  // scrolled to the right end: the white board continues to the last column
  await page.locator('.board-frame .board-scroll').evaluate((s) => { s.scrollLeft = s.scrollWidth; });
  await expect(page.locator('.board-frame')).toHaveScreenshot('roadmap-right.png', { mask: [page.locator('.kcard-foot')] });
});

test('create Feedback dialog', async ({ page }) => {
  const p = await fixedProduct(page);
  await page.goto(`${ADMIN}/products/${p.id}/feedback`);
  await page.getByRole('main').getByRole('button', { name: '新增 Feedback' }).click();
  const d = page.getByRole('dialog', { name: '新增 Feedback' });
  await expect(d).toBeVisible();
  await expect(d).toHaveScreenshot('feedback-create.png');
});

test('Roadmap settings dialog', async ({ page }) => {
  const p = await fixedProduct(page);
  await page.goto(`${ADMIN}/products/${p.id}/roadmaps`);
  await page.getByRole('button', { name: '看板設定' }).click();
  const d = page.getByRole('dialog', { name: '看板設定' });
  await expect(d.getByRole('textbox', { name: /^名稱/ })).toBeVisible();
  await expect(d).toHaveScreenshot('roadmap-settings.png');
});

test('Login', async ({ page }) => {
  await page.goto(`${PORTAL}/login`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('login.png', { fullPage: true });
});
