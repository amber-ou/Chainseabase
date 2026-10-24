import { expect, test } from '@playwright/test';
import { focused, login, openFirstProduct, tabTo } from './helpers';

/** V02 keyboard walkthrough at phone width (390): the menu sheet is a modal dialog. */
test.describe('phone keyboard walkthrough', () => {
  test('menu sheet: focus moves in, Tab stays inside, Escape returns to the menu button, a link moves focus to main', async ({ page }) => {
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    await openFirstProduct(page);
    await tabTo(page, /開啟選單/);
    await page.keyboard.press('Enter');
    await expect.poll(() => focused(page)).toMatch(/關閉選單/);
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.mobile-sheet')))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '選單' })).toBeHidden();
    await expect.poll(() => focused(page)).toMatch(/開啟選單/);
    await page.keyboard.press('Enter');
    await tabTo(page, /^a Roadmap$/);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/roadmaps/);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('main');
  });
});
