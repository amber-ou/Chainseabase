import { expect, test } from '@playwright/test';
import { login, openFirstProduct, unique } from './helpers';

/**
 * Calendar UI against the server's in-memory FAKE Google Calendar (CALENDAR_PROVIDER=fake).
 * This verifies UI flows only; it is not a real Google integration test.
 */
test('C05 (fake provider): connect, bind, create and edit an event from the dashboard', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  await expect(page.getByText('開發模擬日曆')).toBeVisible();
  await page.getByRole('button', { name: /連結模擬日曆/ }).click();
  await page.getByLabel('日曆', { exact: true }).selectOption({ label: 'Chainseabase 模擬日曆（可編輯）' });
  await page.getByRole('button', { name: '綁定' }).click();
  await page.getByRole('tab', { name: '活動清單' }).click();
  await expect(page.getByText('這段期間沒有活動')).toBeVisible();
  await page.getByRole('button', { name: '新增活動' }).click();
  const d = page.getByRole('dialog', { name: '新增活動' });
  const summary = unique('驗收會議');
  await d.getByLabel('活動名稱').fill(summary);
  await d.getByRole('button', { name: '儲存' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(summary)).toBeVisible();
  await page.getByText(summary).click();
  const e = page.getByRole('dialog', { name: '編輯活動' });
  await e.getByLabel('地點').fill('會議室 B');
  await e.getByRole('button', { name: '儲存' }).click();
  await expect(page.getByText('會議室 B')).toBeVisible();
});

/**
 * C16 (UI part, fake provider): the events view refreshes every 60 s while visible, pauses
 * while the page is hidden, and refreshes at once when the page becomes visible or regains focus.
 * Uses Playwright's fake clock; visibility is simulated by overriding document.visibilityState.
 */
test('C16 (fake provider): 60 s foreground polling, paused in the background, refresh on return', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const polls: string[] = [];
  page.on('request', (r) => { if (r.method() === 'GET' && /\/calendar\/events\?/.test(r.url())) polls.push(r.url()); });
  await page.clock.install();
  await openFirstProduct(page);
  if (await page.getByRole('button', { name: /連結模擬日曆/ }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /連結模擬日曆/ }).click();
  }
  if (await page.getByRole('button', { name: '綁定', exact: true }).isVisible().catch(() => false)) {
    await page.getByLabel('日曆', { exact: true }).selectOption({ label: 'Chainseabase 模擬日曆（可編輯）' });
    await page.getByRole('button', { name: '綁定', exact: true }).click();
  }
  await expect.poll(() => polls.length).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle');
  const settle = async () => { await page.waitForLoadState('networkidle'); return polls.length; };
  let n = await settle();

  // foreground: nothing before 60 s, one refresh at 60 s
  await page.clock.runFor(59_000);
  expect(await settle()).toBe(n);
  await page.clock.runFor(1_000);
  await expect.poll(() => polls.length).toBe(n + 1);
  n = await settle();

  // background: no polling for several minutes
  const setVisibility = (state: 'hidden' | 'visible') => page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  await setVisibility('hidden');
  await page.clock.runFor(180_000);
  expect(await settle()).toBe(n);

  // back to the foreground: immediate refresh, then the 60 s cadence resumes
  await setVisibility('visible');
  await expect.poll(() => polls.length).toBe(n + 1);
  n = await settle();
  await page.clock.runFor(60_000);
  await expect.poll(() => polls.length).toBe(n + 1);
  n = await settle();

  // regaining window focus refreshes too
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => polls.length).toBe(n + 1);
});
