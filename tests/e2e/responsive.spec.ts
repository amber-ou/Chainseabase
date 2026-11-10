import { expect, test } from '@playwright/test';
import { PORTAL, expectNoPageOverflow, login, openFirstProduct } from './helpers';

/**
 * V01/V02 (automated part): each core screen at 1440/768/390 has no whole-page
 * horizontal overflow; boards scroll inside their containers.
 * Screenshots are attached for manual review.
 */
for (const section of ['dashboard', 'calendar', 'feedback', 'roadmaps', 'personal', 'users', 'settings']) {
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

test('the create Feedback dialog fits narrow and short windows; Tab stays inside', async ({ page }, info) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  const d = page.getByRole('dialog', { name: '新增 Feedback' });
  await expect(d).toBeVisible();
  await expectNoPageOverflow(page);
  const box = (await d.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  // keyboard: Tab stays inside the dialog
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  expect(inside).toBe(true);
  await info.attach(`create-${page.viewportSize()!.width}`, { body: await page.screenshot(), contentType: 'image/png' });
});

test('portal pages fit the viewport', async ({ page }, info) => {
  await login(page, 'portal', 'tester@e2e.test', '測試者', '/p/product-1/feedback');
  for (const path of ['/p/product-1/feedback', '/p/product-1/roadmap']) {
    await page.goto(`${PORTAL}${path}`);
    await page.waitForLoadState('networkidle');
    await expectNoPageOverflow(page);
    await info.attach(`portal${path.replace(/\//g, '-')}-${page.viewportSize()!.width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  }
});
