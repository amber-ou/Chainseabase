import { test, expect } from '@playwright/test';
import { ADMIN, PORTAL, expectBrandMark, expectNoAxeViolations, expectNoPageOverflow, login } from './helpers';

/**
 * Login page in the running app (docs/change-requests/sidebar-position.md, Login 版面調整, phase 5).
 * This E2E server has no Google client configured, so it shows the "not configured" note and the
 * test-only login; the Google button itself is checked in tests/ui/login.spec.ts (mock).
 */
test('login: split layout on desktop, one column below 1024px, no card, per-site title; sign-in still lands on returnTo', async ({ page }, info) => {
  const width = page.viewportSize()!.width;
  for (const [origin, title] of [[ADMIN, '登入團隊後台'], [PORTAL, '登入回饋網站']] as const) {
    await page.goto(`${origin}/login`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.locator('.login-brand')).toHaveText('Chainseabase');
    await expectBrandMark(page.locator('.login-brand'), 28);
    const aside = page.locator('.login-aside');
    if (width > 1024) {
      const a = (await aside.boundingBox())!;
      expect(Math.abs(a.width - width / 2)).toBeLessThanOrEqual(1);
      expect(await aside.evaluate((e) => [e.childElementCount, e.textContent])).toEqual([0, '']);
    } else {
      await expect(aside).toBeHidden();
    }
    expect(await page.locator('.login-content').evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('0px');
    await expectNoPageOverflow(page);
    await page.screenshot({ path: info.outputPath(`login-${origin === ADMIN ? 'admin' : 'portal'}-${width}.png`), fullPage: true });
    await expectNoAxeViolations(page, `login ${title}`);
  }
  // sign-in (test login) still returns to the requested page
  await login(page, 'admin', 'lead@e2e.test', '專案負責人', '/products');
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\/dashboard$/);
  // the sidebar brand uses the same mark (on phones and tablets, in the menu sheet)
  if (width > 1024) await expectBrandMark(page.locator('aside.sidebar .brand'), 22);
  else {
    await page.getByRole('button', { name: '開啟選單' }).click();
    await expectBrandMark(page.getByRole('dialog', { name: '選單' }).locator('.brand'), 22);
  }
  await page.screenshot({ path: info.outputPath(`after-login-${width}.png`) });
  // the portal header, and the invitation page
  await login(page, 'portal', 'tester@e2e.test', '測試者');
  await expectBrandMark(page.locator('.brand').first(), 22);
  await page.goto(`${PORTAL}/invite?token=${'z'.repeat(43)}`);
  await expectBrandMark(page.locator('.login-card .brand'), 22);
});

test('login: a cancelled Google sign-in shows the reason and how to retry', async ({ page }) => {
  await page.goto(`${ADMIN}/login?error=denied`);
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('你取消了 Google 登入。可以再按一次「使用 Google 登入」重試。');
  await expectNoPageOverflow(page);
});

test('signed out: the admin home and any admin page open the Login page directly (no 請先登入 page), returnTo kept', async ({ page }) => {
  // the admin home
  const res = await page.request.get(`${ADMIN}/`, { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers()['location']).toMatch(/\/login\?returnTo=%2Fproducts$/);
  await page.goto(`${ADMIN}/`);
  await expect(page).toHaveURL(`${ADMIN}/login?returnTo=%2Fproducts`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('登入團隊後台');
  await expect(page.getByText('請先登入')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '前往登入' })).toHaveCount(0);
  // a deep link keeps its path and query, and signing in returns there
  const deep = '/products?from=mail&x=1';
  await page.goto(`${ADMIN}${deep}`);
  await expect(page).toHaveURL(`${ADMIN}/login?returnTo=${encodeURIComponent(deep)}`);
  await page.getByLabel('Email').fill('lead@e2e.test');
  await page.getByLabel('名稱').fill('專案負責人');
  await page.getByRole('button', { name: '測試登入' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  // /products then opens the first product, as before
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\/dashboard$/);
  // signed in: the home and /products keep their usual destinations (no redirect to Login)
  await page.goto(`${ADMIN}/`);
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\/dashboard$/);
  // the Login page itself is never redirected (no loop), signed in or not
  await page.goto(`${ADMIN}/login`);
  await expect(page).toHaveURL(`${ADMIN}/login`);
});

test('signed out: an expired session goes to Login with returnTo; an unreadable account state offers a retry, not a redirect', async ({ page, context }) => {
  const product = '/products/00000000-0000-4000-8000-000000000000/feedback';
  await context.addCookies([{ name: 'csb_session', value: 'expired-or-revoked', url: ADMIN }]);
  await page.goto(`${ADMIN}${product}`);
  await expect(page).toHaveURL(`${ADMIN}/login?returnTo=${encodeURIComponent(product)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('登入團隊後台');
  // /me itself failing is not "signed out": the page says so and retries, it does not send the person away
  let fail = true;
  await page.route('**/api/v1/me', (r) => (fail ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"x","fieldErrors":{},"retryable":true,"requestId":""}}' }) : r.continue()));
  await page.goto(`${ADMIN}/products`);
  await expect(page.getByText('無法確認登入狀態，請檢查連線後重試。')).toBeVisible();
  await expect(page).toHaveURL(`${ADMIN}/products`);
  fail = false;
  await page.getByRole('button', { name: /重試|重新載入/ }).click();
  await expect(page).toHaveURL(`${ADMIN}/login?returnTo=%2Fproducts`);
});
