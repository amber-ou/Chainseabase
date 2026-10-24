import { expect, test } from '@playwright/test';
import { PORTAL, expectNoPageOverflow, login, openFirstProduct } from './helpers';

/**
 * V01/V02 (automated part): each core screen at 1440/768/390 has no whole-page
 * horizontal overflow; boards and the schedule scroll inside their containers.
 * Screenshots are attached for manual review.
 */
for (const section of ['dashboard', 'feedback', 'roadmaps', 'personal', 'users', 'settings']) {
  test(`admin ${section} fits the viewport`, async ({ page }, info) => {
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    await openFirstProduct(page, section);
    await page.waitForLoadState('networkidle');
    await expectNoPageOverflow(page);
    const width = page.viewportSize()!.width;
    if (width < 1024) {
      await expect(page.getByRole('button', { name: '開啟選單' })).toBeVisible();
      await page.getByRole('button', { name: '開啟選單' }).click();
      await expect(page.getByRole('dialog', { name: '選單' }).getByRole('navigation', { name: '後台導覽' })).toBeVisible();
      await page.getByRole('button', { name: '關閉選單' }).click();
    }
    await info.attach(`${section}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}

test('feedback modal and schedule keep five columns with container scrolling', async ({ page }, info) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  const d = page.getByRole('dialog', { name: '新增 Feedback' });
  await d.getByRole('tab', { name: /Schedule/ }).click();
  await expect(d.getByRole('columnheader')).toHaveCount(6);
  await expectNoPageOverflow(page);
  const scroll = await d.locator('.schedule-scroll').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  if (page.viewportSize()!.width < 900) expect(scroll.sw).toBeGreaterThan(scroll.cw);
  // keyboard: Tab stays inside the dialog
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  expect(inside).toBe(true);
  await info.attach(`schedule-${page.viewportSize()!.width}`, { body: await page.screenshot(), contentType: 'image/png' });
});

test('portal pages fit the viewport', async ({ page }, info) => {
  for (const path of ['/p/product-1/feedback', '/p/product-1/roadmap']) {
    await page.goto(`${PORTAL}${path}`);
    await page.waitForLoadState('networkidle');
    await expectNoPageOverflow(page);
    await info.attach(`portal${path.replace(/\//g, '-')}-${page.viewportSize()!.width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  }
});
