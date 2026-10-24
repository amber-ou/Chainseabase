import { expect, test } from '@playwright/test';
import { ADMIN, login, openFirstProduct, unique } from './helpers';

test.describe.configure({ mode: 'serial' });

test('A: bootstrap email becomes team; sidebar keeps the fixed order', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const nav = page.getByRole('navigation', { name: '後台導覽' }).first();
  const labels = await nav.locator('.nav-item').allInnerTexts();
  expect(labels.map((l) => l.replace(/\d+/g, '').trim())).toEqual(['Product', 'Feedback', 'Roadmap', 'Personal', 'Live Portal', 'User', 'Notification', 'Setting']);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('產品1');
});

test('F01/F02/S11/S12/S17: create with schedule draft, continuous creation keeps classification', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  const dialog = page.getByRole('dialog', { name: '新增 Feedback' });
  await expect(dialog.getByLabel('狀態')).toHaveValue(/.+/);
  await expect(dialog.getByLabel('狀態').locator('option:checked')).toHaveText('新貼文');
  await expect(dialog.getByLabel('類別').locator('option:checked')).toHaveText('需求討論');
  await expect(dialog.getByLabel('優先級').locator('option:checked')).toHaveText('P0 非常重要');
  await expect(dialog.getByLabel('版本').locator('option:checked')).toHaveText('未歸類');
  await expect(dialog.getByRole('button', { name: /Person tag：未安排/ })).toBeVisible();
  const title = unique('鍵盤操作');
  await dialog.getByLabel('標題').fill(title);
  await dialog.getByRole('tab', { name: /Schedule/ }).click();
  // header is not a target; clicking row 2 / 前端 fills /2-3
  await dialog.getByRole('button', { name: /第 2 列，前端/ }).click();
  const input = dialog.getByLabel('Schedule 留言或指令');
  await expect(input).toHaveValue('/2-3 ');
  await input.fill('/2-3 規劃焦點順序');
  await input.press('Control+Enter');
  await expect(dialog.locator('.cmd-result', { hasText: '已套用至草稿：寫入 1 筆' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /第 2 列，前端，1 筆內容/ })).toBeVisible();
  await expect(dialog.getByText('尚未儲存到伺服器', { exact: false })).toBeVisible();
  await input.fill('/9-1 不存在');
  await dialog.getByRole('button', { name: '送出' }).click();
  await expect(dialog.locator('.cmd-result', { hasText: '第 9 列不存在。' })).toBeVisible();
  await expect(input).toHaveValue('/9-1 不存在');
  await input.fill('');
  // continuous creation
  await dialog.getByRole('switch', { name: '新增多筆' }).check();
  await dialog.getByRole('tab', { name: '內容' }).click();
  await dialog.getByLabel('優先級').selectOption('P2');
  await dialog.getByRole('button', { name: '建立' }).click();
  await expect(dialog.getByLabel('標題')).toHaveValue('');
  await expect(dialog.getByLabel('優先級')).toHaveValue('P2');
  await expect(dialog.getByRole('tab', { name: 'Schedule' })).toHaveText('Schedule');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();
  // the draft was submitted atomically
  await page.getByRole('button', { name: new RegExp(title) }).click();
  const edit = page.getByRole('dialog', { name: title });
  await edit.getByRole('tab', { name: 'Schedule' }).click();
  await expect(edit.getByRole('button', { name: /第 2 列，前端，1 筆內容/ })).toContainText('規劃焦點順序');
});

test('S11: cancelling a create draft with schedule actions stores nothing', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  const title = unique('取消草稿');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  const dialog = page.getByRole('dialog', { name: '新增 Feedback' });
  await dialog.getByLabel('標題').fill(title);
  await dialog.getByRole('tab', { name: /Schedule/ }).click();
  await dialog.getByRole('button', { name: '新增一排' }).click();
  await dialog.getByLabel('Schedule 留言或指令').fill('/3-1 不會儲存');
  await dialog.getByRole('button', { name: '送出' }).click();
  await expect(dialog.locator('.cmd-result', { hasText: '已套用至草稿：寫入 1 筆' })).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();
  const confirm = page.getByRole('dialog', { name: '捨棄未建立的 Feedback？' });
  await expect(confirm).toContainText('不會建立任何資料');
  await confirm.getByRole('button', { name: '捨棄' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('搜尋 Feedback').fill(title);
  await expect(page.getByText('沒有符合條件的 Feedback')).toBeVisible();
});

test('S02–S05/S17: live schedule commands, clear and history removal', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page, 'feedback');
  const title = unique('排程測試');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  await page.getByRole('dialog').getByLabel('標題').fill(title);
  await page.getByRole('dialog').getByRole('button', { name: '建立' }).click();
  await page.getByRole('button', { name: new RegExp(title) }).click();
  const dlg = page.getByRole('dialog', { name: title });
  await dlg.getByRole('tab', { name: 'Schedule' }).click();
  const input = dlg.getByLabel('Schedule 留言或指令');
  await input.fill('/2-3 工作甲');
  await dlg.getByRole('button', { name: '送出' }).click();
  await expect(dlg.locator('.cmd-result', { hasText: '已寫入 1 筆至 /2-3' })).toBeVisible();
  await input.fill('/2-3 工作乙');
  await dlg.getByRole('button', { name: '送出' }).click();
  await expect(dlg.getByRole('button', { name: /第 2 列，前端，2 筆內容/ })).toBeVisible();
  await input.fill('/2-3 delete');
  await dlg.getByRole('button', { name: '送出' }).click();
  await expect(dlg.locator('.cmd-result', { hasText: '已清空 2 筆（/2-3）' })).toBeVisible();
  await expect(dlg.getByRole('button', { name: /第 2 列，前端，0 筆內容/ })).toBeVisible();
  // removing the clear history must not restore anything
  await dlg.getByRole('tab', { name: '操作歷史紀錄' }).click();
  await dlg.getByRole('button', { name: /移除操作紀錄：清空 \/2-3（2 筆）/ }).click();
  const confirm = page.getByRole('dialog', { name: '移除這筆操作紀錄？' });
  await expect(confirm).toContainText('已清空的內容不會恢復');
  await confirm.getByRole('button', { name: '移除紀錄' }).click();
  await expect(dlg.getByRole('button', { name: /第 2 列，前端，0 筆內容/ })).toBeVisible();
  await dlg.getByRole('tab', { name: /留言區/ }).click();
  await expect(dlg.getByText('操作紀錄已移除')).toBeVisible();
  // Escape closes the dialog and focus returns to the list row
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(page.url()).toContain(`${base}/feedback`);
});

test('R06/R10: roadmap move via keyboard-accessible menu changes only the status', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  const title = unique('看板卡片');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  await page.getByRole('dialog').getByLabel('標題').fill(title);
  await page.getByRole('dialog').getByLabel('優先級').selectOption('P1');
  await page.getByRole('dialog').getByRole('button', { name: '建立' }).click();
  await page.getByRole('link', { name: 'Roadmap' }).first().click();
  await expect(page.getByRole('listitem', { name: /需求池/ })).toContainText(title);
  const menuBtn = page.getByRole('button', { name: `移動「${title}」` });
  await menuBtn.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '進行中' }).click();
  await expect(page.getByRole('listitem', { name: /^進行中/ })).toContainText(title);
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: '已將' })).toHaveText(new RegExp(`已將「${title}」移到「進行中」`));
  await page.getByRole('listitem', { name: /^進行中/ }).getByRole('button', { name: title, exact: true }).click();
  const dlg = page.getByRole('dialog', { name: title });
  await expect(dlg.getByLabel('狀態').locator('option:checked')).toHaveText('進行中');
  await expect(dlg.getByLabel('優先級')).toHaveValue('P1');
});

test('P03/P05: personal private column with autosave, feedback fields untouched', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page, 'settings');
  await page.getByRole('tab', { name: '管理 Person tag' }).click();
  await page.getByLabel('新增 Person tag').fill('UIUX');
  await page.getByRole('button', { name: '新增' }).click();
  await expect(page.getByLabel('名稱').first()).toHaveValue('UIUX');
  await page.getByRole('tab', { name: '個人設定' }).click();
  await page.getByRole('button', { name: /我的 Person tag/ }).click();
  await page.getByRole('listbox', { name: '我的 Person tag' }).getByText('UIUX').click();
  await page.keyboard.press('Escape');
  await page.goto(`${base}/feedback`);
  const title = unique('私人整理');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('標題').fill(title);
  await dialog.getByRole('button', { name: /Person tag：/ }).click();
  await dialog.getByRole('listbox', { name: 'Person tag' }).getByText('UIUX').click();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: '建立' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`${base}/personal`);
  await expect(page.getByRole('listitem', { name: /負責的 Feedback/ })).toContainText(title);
  await page.getByLabel('新欄位名稱').fill('本週');
  await page.getByRole('button', { name: '新增欄位' }).click();
  await expect(page.getByText('已儲存')).toBeVisible();
  await page.getByRole('button', { name: `移動「${title}」` }).click();
  await page.getByRole('menuitem', { name: '本週' }).click();
  await expect(page.getByRole('listitem', { name: /^本週/ })).toContainText(title);
  await expect(page.getByText('已儲存')).toBeVisible();
  // Feedback status unchanged
  await page.goto(`${base}/feedback`);
  await expect(page.getByRole('region', { name: '新貼文 的 Feedback' })).toContainText(title);
});

test('A10/A05: a tester gets a permission screen on the admin site', async ({ page }) => {
  await login(page, 'admin', 'tester@e2e.test', '測試者');
  await page.goto(`${ADMIN}/products`);
  await expect(page.getByText('沒有後台權限')).toBeVisible();
});

test('A08: a slow response from the previous product never overwrites the newly selected product', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page, 'feedback');
  const firstId = base.split('/').pop()!;
  const name = unique('產品乙');
  const created = await page.evaluate(async (n) => {
    const r = await fetch('/api/v1/products', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n }) });
    return (await r.json()).data as { id: string };
  }, name);
  const onlyInFirst = unique('只在產品1');
  await page.evaluate(async ({ p, t }) => {
    await fetch(`/api/v1/products/${p}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ title: t }) });
  }, { p: firstId, t: onlyInFirst });
  // delay every feedback list response of the first product
  await page.route(new RegExp(`/api/v1/products/${firstId}/feedback\\?`), async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.goto(`${base}/feedback`);
  await page.getByLabel('切換產品').first().selectOption(created.id);
  await page.waitForURL(new RegExp(`/products/${created.id}/feedback`));
  await expect(page.getByText('這個產品還沒有 Feedback')).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(page.getByText(onlyInFirst)).toHaveCount(0);
  await expect(page.getByText('這個產品還沒有 Feedback')).toBeVisible();
});
