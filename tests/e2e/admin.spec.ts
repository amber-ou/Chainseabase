import { expect, test } from '@playwright/test';
import { ADMIN, login, openFirstProduct, unique } from './helpers';

test.describe.configure({ mode: 'serial' });

test('A: bootstrap email becomes team; sidebar keeps the fixed order', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const nav = page.getByRole('navigation', { name: '後台導覽' }).first();
  const labels = await nav.locator('.nav-item').allInnerTexts();
  expect(labels.map((l) => l.replace(/\d+/g, '').trim())).toEqual(['Product', 'Calendar', 'Feedback', 'Roadmap', 'User', 'Live Portal', 'Personal', 'Notification']);
  // Setting opens from the account area (checklist A01/A02)
  await expect(page.locator('.sidebar-foot').first().getByRole('link', { name: /開啟 Setting/ })).toHaveAttribute('href', /\/settings$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Product');
  await expect(page.getByRole('list', { name: '產品' }).getByRole('link', { name: /^產品1/ })).toHaveAttribute('aria-current', 'true');
});

// phase 2 FB01-FB09: the create dialog, its unchanged defaults, continuous creation
test('FB: create dialog keeps the defaults; continuous creation keeps the classification', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  const dialog = page.getByRole('dialog', { name: '新增 Feedback' });
  // FB03: status, category and Person tag pills with the product's defaults; FB08: no other controls
  await expect(dialog.getByRole('button', { name: '狀態：新貼文' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '類別：需求討論' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Person tag：未安排' })).toBeVisible();
  for (const gone of ['優先級', '版本', '公開範圍']) await expect(dialog.getByLabel(gone)).toHaveCount(0);
  await expect(dialog.getByRole('tab')).toHaveCount(0);
  // FB02: placeholders are hints, not values
  await expect(dialog.getByLabel('標題')).toHaveValue('');
  await expect(dialog.getByLabel('標題')).toHaveAttribute('placeholder', '請輸入標題');
  await expect(dialog.getByLabel('描述')).toHaveAttribute('placeholder', '簡短描述建議或是Bug');
  // FB06: the real author, no fixed time
  await expect(dialog.getByText('專案負責人')).toBeVisible();
  await expect(dialog.getByText('建立後記錄時間')).toBeVisible();
  // a required title: the error is next to the field and nothing is created
  await dialog.getByRole('button', { name: '建立' }).click();
  await expect(dialog.getByText('標題不可空白')).toBeVisible();
  const title = unique('連續建立');
  await dialog.getByLabel('標題').fill(title);
  await dialog.getByRole('button', { name: '狀態：新貼文' }).click();
  await page.getByRole('menuitemradio', { name: '進行中' }).click();
  await dialog.getByRole('switch', { name: '新增多筆' }).click();
  await dialog.getByRole('button', { name: '建立' }).click();
  await expect(dialog.getByLabel('標題')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: '狀態：進行中' })).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // the hidden fields kept their defaults: internal, P0, no version
  await page.getByLabel('搜尋 Feedback').fill(title);
  await page.getByRole('button', { name: new RegExp(title) }).first().click();
  const edit = page.getByRole('dialog', { name: title });
  await expect(edit.getByLabel('狀態').locator('option:checked')).toHaveText('進行中');
  await expect(edit.getByLabel('優先級')).toHaveValue('P0');
  await expect(edit.getByLabel('公開範圍')).toHaveValue('internal');
  await expect(edit.getByLabel('版本').locator('option:checked')).toHaveText('未歸類');
  await expect(edit.getByRole('tab', { name: 'Schedule' })).toHaveCount(0);
});

test('FB04/IM: a new tag and images are saved with the Feedback and shown in its detail', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  const dialog = page.getByRole('dialog', { name: '新增 Feedback' });
  const title = unique('附圖片');
  await dialog.getByLabel('標題').fill(title);
  // ＋: create a new tag and apply it; removing it from the Feedback does not delete the tag
  const tagName = unique('即時標籤').slice(0, 20);
  await dialog.getByRole('button', { name: /^加入標籤/ }).click();
  const picker = page.getByRole('dialog', { name: '加入標籤' });
  await picker.getByLabel('搜尋或輸入新標籤').fill(tagName);
  await picker.getByRole('button', { name: `建立「${tagName}」並加入` }).click();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button', { name: `移除標籤「${tagName}」` })).toBeVisible();
  // images: a real upload with a preview
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAwAAAAJCAIAAACJ2loDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFElEQVQYlWMwTltFEDGMKmIgJggAdHuIRVoOAaQAAAAASUVORK5CYII=', 'base64');
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: png });
  await expect(dialog.getByRole('img', { name: /圖片 1：screen\.png/ })).toBeVisible();
  await expect(dialog.getByRole('status').filter({ hasText: '上傳中' })).toHaveCount(0);
  // a file that is too large is refused before upload, with the reason
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(dialog.getByText('「big.png」超過 5 MB。')).toBeVisible();
  await dialog.getByRole('button', { name: '建立' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('搜尋 Feedback').fill(title);
  await page.getByRole('button', { name: new RegExp(title) }).first().click();
  const detail = page.getByRole('dialog', { name: title });
  const img = detail.getByRole('img', { name: '圖片 1' });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
  await expect(detail.getByRole('button', { name: new RegExp(`標籤：.*${tagName}`) })).toBeVisible();
});

test('cancelling a create with input and an image asks first and stores nothing', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  const title = unique('取消草稿');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  const dialog = page.getByRole('dialog', { name: '新增 Feedback' });
  await dialog.getByLabel('標題').fill(title);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAwAAAAJCAIAAACJ2loDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFElEQVQYlWMwTltFEDGMKmIgJggAdHuIRVoOAaQAAAAASUVORK5CYII=', 'base64');
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
  await expect(dialog.getByRole('img', { name: /圖片 1/ })).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();
  const confirm = page.getByRole('alertdialog', { name: '捨棄未建立的 Feedback？' });
  await expect(confirm).toContainText('不會建立任何資料');
  await confirm.getByRole('button', { name: '捨棄' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('搜尋 Feedback').fill(title);
  await expect(page.getByText('沒有符合目前搜尋或篩選條件的 Feedback', { exact: false })).toBeVisible();
});

test('R06/R10: roadmap move via keyboard-accessible menu changes only the status', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  const title = unique('看板卡片');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  await page.getByRole('dialog').getByLabel('標題').fill(title);
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
  await expect(dlg.getByLabel('優先級')).toHaveValue('P0');
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
  await page.getByRole('menuitemcheckbox', { name: 'UIUX' }).click();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: '建立' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`${base}/personal`);
  await expect(page.getByRole('listitem', { name: /負責的 Feedback/ })).toContainText(title);
  await page.getByRole('button', { name: '新增欄位' }).click();
  const add = page.getByRole('dialog', { name: '新增欄位' });
  await add.getByLabel('欄位名稱').fill('本週');
  await add.getByRole('button', { name: '新增', exact: true }).click();
  await expect(add).toHaveCount(0);
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
