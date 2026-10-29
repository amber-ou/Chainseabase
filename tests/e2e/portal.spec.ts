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

test('WIN-04: anonymous visitors get a login prompt and no content (pages, direct links, API)', async ({ page }) => {
  for (const path of ['/', '/p/product-1/feedback', '/p/product-1/roadmap', '/p/product-1/feedback?item=00000000-0000-4000-8000-000000000000']) {
    await page.goto(`${PORTAL}${path}`);
    await expect(page.getByText('請先登入')).toBeVisible();
    await expect(page.getByText(publicTitle)).toHaveCount(0);
    await expect(page.getByText('產品1')).toHaveCount(0);
  }
  await page.getByRole('link', { name: '前往登入' }).click();
  await page.waitForURL(/\/login\?returnTo=/);
  for (const path of ['/public/products', '/public/products/product-1/feedback', `/public/products/product-1/feedback?q=${encodeURIComponent('公開需求')}`]) {
    const r = await page.request.get(`${PORTAL}/api/v1${path}`);
    expect(r.status(), path).toBe(401);
    expect(await r.text()).not.toContain(publicTitle);
  }
});

test('F09/R14: the invited tester sees only public items, never internal ones', async ({ page }) => {
  await login(page, 'portal', 'tester@e2e.test', '測試者', '/p/product-1/feedback');
  await page.goto(`${PORTAL}/p/product-1/feedback`);
  await expect(page.getByText(publicTitle)).toBeVisible();
  await expect(page.getByText(internalTitle)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '後台導覽' })).toHaveCount(0);
  const r = await page.request.get(`${PORTAL}/api/v1/public/products/product-1/feedback?q=${encodeURIComponent('內部需求')}`);
  expect(r.status()).toBe(200);
  expect(await r.text()).not.toContain(internalTitle);
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
  await expect(view.getByText('此留言會顯示在前台網站')).toBeVisible();
});

test('A02/WIN-04: a logged-in but uninvited account sees a no-membership notice and no content', async ({ page }) => {
  await login(page, 'portal', 'stranger@e2e.test', '路人', '/p/product-1/feedback');
  for (const path of ['/', '/p/product-1/feedback', '/p/product-1/roadmap']) {
    await page.goto(`${PORTAL}${path}`);
    await expect(page.getByRole('alert').getByText('尚未受邀', { exact: true })).toBeVisible();
    await expect(page.getByText(publicTitle)).toHaveCount(0);
  }
  const r = await page.request.get(`${PORTAL}/api/v1/public/products/product-1/feedback`);
  expect(r.status()).toBe(404);
  expect(await r.text()).not.toContain(publicTitle);
  await expect(page.getByRole('button', { name: '改用其他帳號' })).toBeVisible();
});

test('host separation: portal host does not serve admin pages; admin host does not serve portal pages', async ({ page }) => {
  const r1 = await page.goto(`${PORTAL}/products`);
  expect(r1?.status()).toBe(404);
  const r2 = await page.goto(`${ADMIN}/p/product-1/feedback`);
  expect(r2?.status()).toBe(404);
});
