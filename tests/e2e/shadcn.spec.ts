import { test, expect, type Page } from '@playwright/test';
import { ADMIN, login, openFirstProduct, unique, expectNoPageOverflow } from './helpers';

/**
 * Product page as a product list (docs/change-requests/sidebar-position.md, phase 3): fixed title,
 * 新增產品 kept, rename moved into each row's menu, list selection synced with the sidebar switcher.
 * Deletion from the row menu is covered by product-delete.spec.ts (phase 4).
 */
const list = (page: Page) => page.getByRole('list', { name: '產品' });
const row = (page: Page, name: string) => list(page).getByRole('link', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
const actions = (page: Page, name: string) => list(page).getByRole('button', { name: `${name} 的操作`, exact: true });
// the sidebar's own switcher is always in the DOM (hidden on phones, where the menu sheet shows a copy)
const sidebarSwitch = (page: Page) => page.locator('aside.sidebar #product-switch');
const idOf = (url: string) => url.match(/\/products\/([0-9a-f-]{36})/)![1];
async function slugOf(page: Page, id: string) {
  const r = await page.request.get(`${ADMIN}/api/v1/products`);
  return ((await r.json()).data as { id: string; slug: string }[]).find((p) => p.id === id)!.slug;
}

test('Product lists the products with a fixed title; header switcher, rename button and calendar are gone', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Product');
  const main = page.locator('main');
  await expect(main.getByText('產品管理與 Google 共用日曆')).toHaveCount(0);
  await expect(main.getByRole('combobox')).toHaveCount(0);
  await expect(main.getByRole('button', { name: '重新命名', exact: true })).toHaveCount(0);
  await expect(main.getByRole('region', { name: '產品日曆' })).toHaveCount(0);
  await expect(main.getByRole('heading', { name: '產品日曆' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: /連結模擬日曆/ })).toHaveCount(0);
  await expect(main.getByRole('button', { name: '新增產品', exact: true })).toBeVisible();
  // the existing default product is one of the rows, selected, and marked as current
  await expect(row(page, '產品1')).toHaveAttribute('aria-current', 'true');
  await expect(list(page).getByRole('listitem').filter({ hasText: '產品1' }).getByText('目前產品')).toBeVisible();
  // its menu: rename, then (separated) the destructive delete (product-delete.spec.ts)
  await actions(page, '產品1').click();
  await expect(page.getByRole('menuitem')).toHaveText(['重新命名', '刪除產品']);
  await expect(page.getByRole('menu').getByRole('separator')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(actions(page, '產品1')).toBeFocused();
  await expectNoPageOverflow(page);
  await page.screenshot({ path: test.info().outputPath('product-list.png'), fullPage: true });
});

test('create, rename from the row menu and select from the list stay in sync with the sidebar switcher', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const original = await openFirstProduct(page);
  const originalId = idOf(original);
  // create: the new product becomes the selected one everywhere
  await page.getByRole('button', { name: '新增產品', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增產品' });
  await expect(create.getByLabel('產品名稱')).toBeFocused();
  const name = unique('元件驗證');
  await create.getByLabel('產品名稱').fill(name);
  await create.getByRole('button', { name: '建立產品' }).click();
  await expect(create).toBeHidden();
  await expect(row(page, name)).toHaveAttribute('aria-current', 'true');
  const created = page.url();
  const createdId = idOf(created);
  await expect(sidebarSwitch(page)).toHaveValue(createdId);
  const slug = await slugOf(page, createdId);

  // rename from the row menu: current name shown, saved name in the list and the switcher, slug unchanged
  await actions(page, name).click();
  await page.getByRole('menuitem', { name: '重新命名' }).click();
  const rename = page.getByRole('dialog', { name: '重新命名產品' });
  await expect(rename).toContainText(`目前名稱：${name}`);
  await expect(rename.getByLabel('產品名稱')).toHaveValue(name);
  await expect(rename.getByLabel('產品名稱')).toBeFocused();
  await rename.getByLabel('產品名稱').fill(name + ' 更新');
  await rename.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(rename).toBeHidden();
  await expect(row(page, name + ' 更新')).toBeVisible();
  await expect(sidebarSwitch(page).locator('option:checked')).toHaveText(name + ' 更新');
  await expect(actions(page, name + ' 更新')).toBeFocused();
  expect(page.url()).toBe(created);
  expect(await slugOf(page, createdId)).toBe(slug);

  // a rename right after another one uses the fresh revision (no false conflict)
  await actions(page, name + ' 更新').click();
  await page.getByRole('menuitem', { name: '重新命名' }).click();
  await rename.getByLabel('產品名稱').fill(name + ' 二次');
  await rename.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(rename).toBeHidden();
  await expect(row(page, name + ' 二次')).toBeVisible();

  // select from the list: Product stays open for that product, and the switcher follows
  await row(page, '產品1').click();
  await expect(page).toHaveURL(original + '/dashboard');
  await expect(row(page, '產品1')).toHaveAttribute('aria-current', 'true');
  await expect(sidebarSwitch(page)).toHaveValue(originalId);
  // ...and the other way round on desktop, where the sidebar switcher is shown
  if (page.viewportSize()!.width > 1024) {
    await sidebarSwitch(page).selectOption(createdId);
    await expect(page).toHaveURL(created);
    await expect(row(page, name + ' 二次')).toHaveAttribute('aria-current', 'true');
  }
  await expectNoPageOverflow(page);
});

test('rename dialog keeps a failed input, cancels safely and returns focus to the row menu', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test');
  await openFirstProduct(page);
  await page.route('**/api/v1/products/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REVISION_CONFLICT', message: 'conflict' } }) });
    } else await route.continue();
  });
  await actions(page, '產品1').click();
  await page.getByRole('menuitem', { name: '重新命名' }).click();
  const dialog = page.getByRole('dialog', { name: '重新命名產品' });
  await dialog.getByLabel('產品名稱').fill('保留我的草稿');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('名稱已被其他人更新');
  await expect(dialog.getByLabel('產品名稱')).toHaveValue('保留我的草稿');
  await expect(dialog.getByLabel('產品名稱')).toHaveAttribute('aria-invalid', 'true');
  await expectNoPageOverflow(page);
  await page.screenshot({ path: test.info().outputPath('rename-error.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(actions(page, '產品1')).toBeFocused();
  await expect(row(page, '產品1')).toBeVisible();
  // reopening starts again from the current name; 取消 changes nothing
  await actions(page, '產品1').click();
  await page.getByRole('menuitem', { name: '重新命名' }).click();
  await expect(dialog.getByLabel('產品名稱')).toHaveValue('產品1');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(actions(page, '產品1')).toBeFocused();
});

test('Product list works with the keyboard alone: create, select a row, rename from its menu', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test');
  const original = await openFirstProduct(page);
  // create: Enter opens, typing fills, Tab reaches the confirm button
  await page.getByRole('button', { name: '新增產品', exact: true }).focus();
  await page.keyboard.press('Enter');
  const create = page.getByRole('dialog', { name: '新增產品' });
  await expect(create.getByLabel('產品名稱')).toBeFocused();
  const name = unique('鍵盤清單');
  await page.keyboard.type(name);
  await page.keyboard.press('Tab');
  await expect(create.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(create.getByRole('button', { name: '建立產品', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(create).toBeHidden();
  await expect(row(page, name)).toHaveAttribute('aria-current', 'true');

  // select another row with Enter: the page switches product and focus stays on that row
  await row(page, '產品1').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(original + '/dashboard');
  await expect(row(page, '產品1')).toBeFocused();
  // Tab moves from a row to its menu button
  await row(page, name).focus();
  await page.keyboard.press('Tab');
  await expect(actions(page, name)).toBeFocused();

  // the row menu: Enter opens it on its first item, Escape closes it back to the button
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: '重新命名' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(actions(page, name)).toBeFocused();
  // rename by keyboard
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: '重新命名' })).toBeFocused();
  await page.keyboard.press('Enter');
  const rename = page.getByRole('dialog', { name: '重新命名產品' });
  await expect(rename.getByLabel('產品名稱')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(name + ' 改');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(rename.getByRole('button', { name: '儲存', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rename).toBeHidden();
  await expect(actions(page, name + ' 改')).toBeFocused();
});

test('a long product name stays in its row; the row and its menu are large enough to tap on phones', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test');
  await openFirstProduct(page);
  const headers = { origin: ADMIN };
  const long = unique('非常長的產品名稱') + '：' + '跨部門協作平台與客戶回饋整合專案'.repeat(4);
  const created = await page.request.post(`${ADMIN}/api/v1/products`, { headers, data: { name: long.slice(0, 100) } });
  expect(created.status()).toBe(201);
  const name = (await created.json()).data.name as string;
  await page.reload();
  const item = list(page).getByRole('listitem').filter({ has: page.getByRole('button', { name: `${name} 的操作`, exact: true }) });
  const itemBox = (await item.boundingBox())!;
  const menuBox = (await actions(page, name).boundingBox())!;
  // the menu button is fully inside its row (the name truncates instead of pushing it out)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(itemBox.x + itemBox.width + 1);
  expect(menuBox.x).toBeGreaterThanOrEqual(itemBox.x);
  if (page.viewportSize()!.width <= 640) {
    expect(menuBox.height).toBeGreaterThanOrEqual(44);
    expect(menuBox.width).toBeGreaterThanOrEqual(44);
    expect((await row(page, name).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoPageOverflow(page);
  await page.screenshot({ path: test.info().outputPath('long-name.png'), fullPage: true });
});
