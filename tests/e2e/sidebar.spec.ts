import { expect, test, type Locator, type Page } from '@playwright/test';
import { login, openFirstProduct } from './helpers';

/**
 * Sidebar order and grouping (docs/change-requests/sidebar-position.md, phase 2): top group, then
 * a flexible gap, then the bottom group just above the account area. Runs at 1440 (sidebar) and at
 * 768 / 390 (phone menu sheet), each at the project height and in a short window.
 */
const TOP = ['Product', 'Calendar', 'Feedback', 'Roadmap', 'User', 'Live Portal'];
const BOTTOM = ['Personal', 'Notification', 'Setting'];
const SHORT = { 'desktop-1440': { width: 1440, height: 560 }, 'tablet-768': { width: 768, height: 500 }, 'mobile-390': { width: 390, height: 560 } } as Record<string, { width: number; height: number }>;

async function openNav(page: Page) {
  // the phone menu replaces the sidebar at 1024px and below (globals.css)
  if (page.viewportSize()!.width <= 1024) {
    await page.getByRole('button', { name: '開啟選單' }).click();
    const sheet = page.getByRole('dialog', { name: '選單' });
    return { container: sheet, nav: sheet.getByRole('navigation', { name: '後台導覽' }), phone: true };
  }
  const aside = page.locator('aside.sidebar');
  return { container: aside, nav: aside.getByRole('navigation', { name: '後台導覽' }), phone: false };
}

const box = async (l: Locator) => (await l.boundingBox())!;
const label = (t: string) => t.replace(/\d+/g, '').trim();
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const short of [false, true]) {
  test(`sidebar order, grouping, focus order and account area${short ? ' (short window)' : ''}`, async ({ page }, info) => {
    if (short) await page.setViewportSize(SHORT[info.project.name]);
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    await openFirstProduct(page);
    const { container, nav, phone } = await openNav(page);
    const items = nav.locator('.nav-item');

    // every item once, in order; the DOM order is the order on screen (waits for the shell to finish
    // loading the products first: allInnerTexts() alone reads whatever is there, even nothing)
    await expect(items).toHaveCount(TOP.length + BOTTOM.length);
    expect((await items.allInnerTexts()).map(label)).toEqual([...TOP, ...BOTTOM]);
    type Box = { x: number; y: number; width: number; height: number };
    const boxes: { item: Box; icon: Box }[] = [];
    for (let i = 0; i < TOP.length + BOTTOM.length; i++) {
      // measured without scrolling in between, so every position shares one scroll offset
      const item = items.nth(i);
      boxes.push({ item: await box(item), icon: await box(item.locator('svg').first()) });
    }
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].item.y).toBeGreaterThan(boxes[i - 1].item.y);
    // icons and labels share one left edge in both groups
    for (const b of boxes) {
      expect(Math.abs(b.item.x - boxes[0].item.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.icon.x - boxes[0].icon.x)).toBeLessThanOrEqual(1);
    }

    // the bottom three are evenly spaced, with the same step as the top group
    const step = (i: number) => boxes[i + 1].item.y - boxes[i].item.y;
    const topStep = step(0);
    for (let i = TOP.length; i < boxes.length - 1; i++) expect(Math.abs(step(i) - topStep)).toBeLessThanOrEqual(1);
    // a visible gap separates the groups (at least the 12px minimum beyond the normal step)
    const gap = step(TOP.length - 1);
    expect(gap).toBeGreaterThanOrEqual(topStep + 12 - 1);

    // the bottom group sits on the account area: Setting, then the account row and logout right below
    const account = container.locator('.sidebar-foot');
    const logout = container.getByRole('button', { name: '登出' });
    await logout.scrollIntoViewIfNeeded();
    const accountBox = await box(account);
    const setting = await box(items.nth(boxes.length - 1));
    expect(accountBox.y).toBeGreaterThanOrEqual(setting.y + setting.height);
    expect(accountBox.y - (setting.y + setting.height)).toBeLessThanOrEqual(24);
    // in a window tall enough, the free space is between the groups, not under the account area
    if (!short && !phone) {
      const aside = await box(container);
      expect(aside.y + aside.height - (accountBox.y + accountBox.height)).toBeLessThanOrEqual(24);
      expect(gap).toBeGreaterThan(topStep + 40);
    }

    // account and logout are reachable, visible and not covered by navigation items
    await expect(logout).toBeVisible();
    const logoutBox = await box(logout);
    for (let i = 0; i < boxes.length; i++) expect(overlaps(await box(items.nth(i)), logoutBox)).toBe(false);
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? '', { x: logoutBox.x + logoutBox.width / 2, y: logoutBox.y + logoutBox.height / 2 });
    expect(hit).toContain('登出');

    // keyboard: from the product switcher, Tab visits the items in the visual order, then logout
    await container.locator('#product-switch').focus();
    const visited: string[] = [];
    for (let i = 0; i < TOP.length + BOTTOM.length + 1; i++) {
      await page.keyboard.press('Tab');
      visited.push(label(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText ?? '')));
    }
    expect(visited).toEqual([...TOP, ...BOTTOM, '登出']);

    await page.screenshot({ path: info.outputPath(`sidebar-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`) });
  });
}

test('Notification panel opens fully on screen from the bottom group', async ({ page }, info) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const { nav } = await openNav(page);
  const trigger = nav.getByRole('button', { name: /^Notification/ });
  await trigger.click();
  const panel = page.getByRole('dialog', { name: '通知' });
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  const p = await box(panel);
  const vp = page.viewportSize()!;
  expect(p.y).toBeGreaterThanOrEqual(0);
  expect(p.y + p.height).toBeLessThanOrEqual(vp.height);
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.x + p.width).toBeLessThanOrEqual(vp.width);
  // nothing clips or covers it: its corners hit the panel itself
  for (const [x, y] of [[p.x + 4, p.y + 4], [p.x + p.width - 4, p.y + p.height - 4]]) {
    expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[aria-label="通知"]')), { x, y })).toBe(true);
  }
  await page.screenshot({ path: info.outputPath(`notification-${vp.width}x${vp.height}.png`) });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
