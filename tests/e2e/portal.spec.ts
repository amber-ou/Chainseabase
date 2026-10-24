import { expect, test } from '@playwright/test';
import { ADMIN, PORTAL, login, openFirstProduct, unique } from './helpers';

test.describe.configure({ mode: 'serial' });

let publicTitle = '';
let internalTitle = '';

test('setup: team publishes one item and keeps one internal', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  publicTitle = unique('公開需求');
  internalTitle = unique('內部需求');
  for (const [title, vis] of [[publicTitle, 'public'], [internalTitle, 'internal']] as const) {
    await page.getByRole('button', { name: '新增 Feedback' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('標題').fill(title);
    await d.getByLabel('公開範圍').selectOption(vis);
    await d.getByRole('button', { name: '建立' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('F09/R14: anonymous visitors see only public items and cannot interact', async ({ page }) => {
  await page.goto(`${PORTAL}/p/product-1/feedback`);
  await expect(page.getByText(publicTitle)).toBeVisible();
  await expect(page.getByText(internalTitle)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '後台導覽' })).toHaveCount(0);
  await page.getByRole('button', { name: /投票，目前 0 票/ }).first().click();
  await page.waitForURL(/\/login/);
});

test('F08/F12: invited tester creates feedback, votes once and comments', async ({ page }) => {
  await login(page, 'portal', 'tester@e2e.test', '測試者', '/p/product-1/feedback');
  await page.goto(`${PORTAL}/p/product-1/feedback`);
  const mine = unique('測試者建議');
  await page.getByRole('button', { name: '新增回饋' }).click();
  const d = page.getByRole('dialog', { name: '新增回饋' });
  await d.getByLabel('標題').fill(mine);
  await d.getByLabel('描述').fill('**粗體** <script>alert(1)</script>');
  await d.getByRole('button', { name: '送出' }).click();
  const view = page.getByRole('dialog', { name: mine });
  await expect(view.locator('strong', { hasText: '粗體' })).toBeVisible();
  await expect(view.locator('script')).toHaveCount(0);
  const vote = view.getByRole('button', { name: /投票，目前 0 票/ });
  await vote.click();
  await expect(view.getByRole('button', { name: /收回投票，目前 1 票/ })).toBeVisible();
  await view.getByLabel('新增留言').fill('期待這個功能');
  await view.getByRole('button', { name: '送出留言' }).click();
  await expect(view.getByText('期待這個功能')).toBeVisible();
  await expect(view.getByText('此留言會公開顯示')).toBeVisible();
});

test('A02: logged-in but uninvited account sees a clear no-membership notice', async ({ page }) => {
  await login(page, 'portal', 'stranger@e2e.test', '路人', '/p/product-1/feedback');
  await page.goto(`${PORTAL}/p/product-1/feedback`);
  await expect(page.getByText('尚未受邀參與「產品1」')).toBeVisible();
});

test('host separation: portal host does not serve admin pages; admin host does not serve portal pages', async ({ page }) => {
  const r1 = await page.goto(`${PORTAL}/products`);
  expect(r1?.status()).toBe(404);
  const r2 = await page.goto(`${ADMIN}/p/product-1/feedback`);
  expect(r2?.status()).toBe(404);
});
