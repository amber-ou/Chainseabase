import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ADMIN, PORTAL, expectNoPageOverflow, listProducts, login, openFirstProduct } from './helpers';

/**
 * Site-wide UI/UX pass: one screenshot per main page at 1440 / 768 / 390, on the isolated E2E database
 * with a few sample items (fake Google and e-mail). Also checks each page renders without a crash or
 * a sideways scroll. Not a substitute for the page-specific tests.
 */
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath(`${name}-${page.viewportSize()!.width}.png`), fullPage: true });
};

async function sampleFeedback(page: Page, productId: string) {
  // the items this page clicks must exist whatever other tests created before (only missing titles are added)
  const list = await page.request.get(`${ADMIN}/api/v1/products/${productId}/feedback?limit=100`);
  const have = new Set(((await list.json()).data as { title: string }[]).map((f) => f.title));
  for (const title of ['登入後首頁載入過慢', '匯出報表時欄位順序錯誤', '希望支援批次修改狀態'].filter((t) => !have.has(t))) {
    const r = await page.request.post(`${ADMIN}/api/v1/products/${productId}/feedback`, {
      headers: { origin: ADMIN, 'idempotency-key': randomUUID() }, data: { title, description: `${title}，請協助確認。` },
    });
    expect(r.status(), await r.text()).toBe(201);
  }
}

test('every main page renders for the preview', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // signed out
  await page.goto(`${ADMIN}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('登入團隊後台');
  await shot(page, 'login-admin');

  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page);
  const productId = base.split('/').pop()!;
  await sampleFeedback(page, productId);
  if ((await listProducts(page)).length < 2) {
    await page.request.post(`${ADMIN}/api/v1/products`, { headers: { origin: ADMIN }, data: { name: '官方網站' } });
  }
  for (const [section, name] of [['dashboard', 'product'], ['calendar', 'calendar'], ['feedback', 'feedback'], ['roadmaps', 'roadmap'], ['users', 'user'], ['personal', 'personal'], ['settings', 'setting']] as const) {
    await page.goto(`${base}/${section}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoPageOverflow(page);
    await shot(page, name);
  }
  // a detail: the feedback modal, and a member profile
  await page.goto(`${base}/feedback`);
  // search first: with many items from other tests it may not be on the first page
  await page.getByLabel('搜尋 Feedback').fill('登入後首頁載入過慢');
  await page.getByRole('button', { name: '登入後首頁載入過慢' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, 'feedback-detail');
  await page.keyboard.press('Escape');
  await page.goto(`${base}/users`);
  await page.getByRole('main').getByRole('link', { name: '專案負責人' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('專案負責人');
  await shot(page, 'user-profile');
  // the notification panel
  await page.goto(`${base}/dashboard`);
  if (page.viewportSize()!.width <= 1024) await page.getByRole('button', { name: '開啟選單' }).click();
  await page.getByRole('button', { name: /^Notification/ }).last().click();
  await expect(page.getByRole('dialog', { name: '通知' })).toBeVisible();
  await shot(page, 'notification');

  // portal (invited tester), and the invitation page
  await login(page, 'portal', 'tester@e2e.test', '測試者');
  await page.goto(`${PORTAL}/`);
  await page.waitForLoadState('networkidle');
  await shot(page, 'portal-home');
  const slug = (await (await page.request.get(`${PORTAL}/api/v1/public/products`)).json()).data[0]?.slug;
  if (slug) {
    await page.goto(`${PORTAL}/p/${slug}/feedback`);
    await page.waitForLoadState('networkidle');
    await expectNoPageOverflow(page);
    await shot(page, 'portal-feedback');
    await page.goto(`${PORTAL}/p/${slug}/roadmap`);
    await page.waitForLoadState('networkidle');
    await shot(page, 'portal-roadmap');
  }
  await page.goto(`${PORTAL}/invite?token=${'p'.repeat(43)}`);
  await page.waitForLoadState('networkidle');
  await shot(page, 'invite');
  expect(errors).toEqual([]);
});
