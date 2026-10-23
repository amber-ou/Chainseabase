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
