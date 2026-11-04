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
