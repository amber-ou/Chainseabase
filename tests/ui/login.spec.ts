import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/**
 * Login layout and button behaviour (docs/change-requests/sidebar-position.md, Login 版面調整),
 * rendered from the real LoginScreen with a configured Google login. MOCK: nothing reaches Google;
 * the OAuth start request is intercepted. The server side (start, callback, returnTo, session) is
 * covered by tests/integration/identity.test.ts with the fake OAuth client.
 */
async function open(page: Page, query = '') {
  await page.route('**/api/v1/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":null}' }));
  await page.goto(`/login.html${query}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
const google = (page: Page) => page.getByRole('link', { name: /使用 Google 登入|正在前往 Google/ });

test('layout: split on wide screens, one column on tablet and phone; the blank half is empty and neutral', async ({ page }, info) => {
  await open(page);
  const width = page.viewportSize()!.width;
  const pane = page.locator('.login-pane');
  const aside = page.locator('.login-aside');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('登入團隊後台');
  await expect(page.getByText('使用 Google 帳號登入。登入本身不代表已加入團隊或受邀產品；互動權限由邀請決定。')).toBeVisible();
  await expect(page.locator('.login-brand')).toHaveText('Chainseabase');
  await expect(page.locator('.login-brand svg')).toBeVisible();
  // no card: no border, radius or shadow around the sign-in content
  for (const el of [pane, page.locator('.login-content')]) {
    const css = await el.evaluate((e) => { const s = getComputedStyle(e); return [s.borderTopWidth, s.borderRadius, s.boxShadow]; });
    expect(css).toEqual(['0px', '0px', 'none']);
  }
  const content = (await page.locator('.login-content').boundingBox())!;
  const button = (await google(page).boundingBox())!;
  expect(Math.abs(button.width - content.width)).toBeLessThanOrEqual(1); // full content width
  expect(content.width).toBeLessThanOrEqual(400);
  if (width > 1024) {
    const p = (await pane.boundingBox())!;
    const a = (await aside.boundingBox())!;
    expect(Math.abs(p.width - a.width)).toBeLessThanOrEqual(1);
    expect(p.width + a.width).toBeGreaterThanOrEqual(width - 1);
    expect(a.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1);
    // left and right touch (no divider); the right half has nothing in it and one plain colour
    expect(Math.abs(p.x + p.width - a.x)).toBeLessThanOrEqual(1);
    expect(await aside.evaluate((e) => [e.childElementCount, e.textContent, getComputedStyle(e).backgroundImage, getComputedStyle(e).borderLeftWidth])).toEqual([0, '', 'none', '0px']);
    expect(await aside.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(238, 238, 238)');
    // the content sits in the middle of the left half
    expect(Math.abs(content.x + content.width / 2 - (p.x + p.width / 2))).toBeLessThanOrEqual(1);
  } else {
    await expect(aside).toBeHidden();
    const margin = content.x;
    expect(margin).toBeGreaterThanOrEqual(16);
    if (width < 500) expect(margin).toBeLessThanOrEqual(24);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: info.outputPath(`login-${width}.png`), fullPage: true });
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => (await (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((v: any) => v.id));
  expect(violations).toEqual([]);
});

test('a short window scrolls: nothing is cut off, the error and the button stay reachable', async ({ page }, info) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 420 });
  await open(page, '?error=denied');
  await google(page).scrollIntoViewIfNeeded();
  await expect(google(page)).toBeInViewport();
  await expect(page.getByRole('alert')).toBeVisible();
  const bottom = await google(page).evaluate((e) => e.getBoundingClientRect().bottom + window.scrollY);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThanOrEqual(bottom);
  await page.screenshot({ path: info.outputPath(`login-short-${page.viewportSize()!.width}.png`), fullPage: true });
});

test('the Google button keeps the OAuth start and returnTo; one click only, with a visible pending state', async ({ page }) => {
  let starts = 0;
  // 204: the browser stays on this page, as it does while Google is loading
  await page.route('**/api/v1/auth/google/start**', (r) => { starts++; return r.fulfill({ status: 204 }); });
  await open(page, '?returnTo=%2Fproducts%2Fabc%2Ffeedback');
  await expect(google(page)).toHaveAttribute('href', '/api/v1/auth/google/start?returnTo=%2Fproducts%2Fabc%2Ffeedback');
  await google(page).click();
  await expect(google(page)).toHaveText('正在前往 Google…');
  await expect(google(page)).toHaveAttribute('aria-busy', 'true');
  await google(page).click({ force: true });
  await google(page).press('Enter');
  await page.waitForTimeout(300);
  expect(starts).toBe(1);
});

test('default destinations and titles stay per site: admin /products, portal /', async ({ page }) => {
  await open(page);
  await expect(google(page)).toHaveAttribute('href', '/api/v1/auth/google/start?returnTo=%2Fproducts');
  await open(page, '?site=portal');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('登入回饋網站');
  await expect(google(page)).toHaveAttribute('href', '/api/v1/auth/google/start?returnTo=%2F');
});

test('cancelled, expired and failed sign-ins: a reason and a way to retry; not configured: no button', async ({ page }) => {
  for (const [code, text] of [['denied', '你取消了 Google 登入。'], ['state', '登入流程已過期或驗證失敗，請重新登入。'], ['unverified', '此 Google 帳號的 Email 尚未驗證，無法登入。'], ['failed', 'Google 登入失敗，請稍後再試。'], ['other', 'Google 登入失敗，請稍後再試。']]) {
    await open(page, `?error=${code}`);
    await expect(page.getByRole('alert')).toHaveText(`${text}可以再按一次「使用 Google 登入」重試。`);
    await expect(google(page)).toHaveText('使用 Google 登入');
  }
  await open(page, '?google=off');
  await expect(google(page)).toHaveCount(0);
  await expect(page.getByRole('note')).toContainText('Google 登入尚未設定');
});

test('keyboard: Tab reaches the Google button with a visible focus ring; Enter follows it', async ({ page }) => {
  let starts = 0;
  await page.route('**/api/v1/auth/google/start**', (r) => { starts++; return r.fulfill({ status: 200, contentType: 'text/html', body: '<p>google</p>' }); });
  await open(page);
  for (let i = 0; i < 5 && !(await google(page).evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(google(page)).toBeFocused();
  const ring = await google(page).evaluate((e) => getComputedStyle(e).boxShadow);
  expect(ring).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect.poll(() => starts).toBe(1);
});
