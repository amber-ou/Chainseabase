import { test, expect } from '@playwright/test';
import { login, openFirstProduct, unique, expectNoPageOverflow } from './helpers';

test('Product shadcn controls preserve create, rename, switch and keyboard focus', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const original = await openFirstProduct(page);
  const originalName = await page.getByRole('heading', { level: 1 }).innerText();
  await page.getByRole('button', { name: '新增產品', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增產品' });
  await expect(create.getByLabel('產品名稱')).toBeFocused();
  const name = unique('元件驗證');
  await create.getByLabel('產品名稱').fill(name);
  await create.getByRole('button', { name: '建立產品' }).click();
  await expect(create).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  const newUrl = page.url();
  expect(newUrl).not.toBe(original + '/dashboard');
  await page.getByRole('button', { name: '重新命名', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重新命名產品' });
  await expect(rename.getByLabel('產品名稱')).toHaveValue(name);
  await rename.getByLabel('產品名稱').fill(name + ' 更新');
  await rename.getByRole('button', { name: '儲存名稱' }).click();
  await expect(rename).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name + ' 更新');
  expect(page.url()).toBe(newUrl);
  await expect(page.getByRole('button', { name: '重新命名', exact: true })).toBeFocused();
  await page.getByRole('combobox', { name: '切換產品', exact: true }).last().click();
  await page.getByRole('option', { name: originalName, exact: true }).click();
  await expect(page).toHaveURL(original + '/dashboard');
  await expectNoPageOverflow(page);
  await page.screenshot({ path: test.info().outputPath('product.png'), fullPage: true });
});

test('Product dialog keeps failed input, cancels safely and restores focus', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test');
  await openFirstProduct(page);
  const title = await page.getByRole('heading', { level: 1 }).innerText();
  await page.route('**/api/v1/products/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REVISION_CONFLICT', message: 'conflict' } }) });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '重新命名', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重新命名產品' });
  await dialog.getByLabel('產品名稱').fill('保留我的草稿');
  await dialog.getByRole('button', { name: '儲存名稱' }).click();
  await expect(dialog.getByRole('alert')).toContainText('名稱已被其他人更新');
  await expect(dialog.getByLabel('產品名稱')).toHaveValue('保留我的草稿');
  await expect(dialog.getByLabel('產品名稱')).toHaveAttribute('aria-invalid', 'true');
  await expectNoPageOverflow(page);
  await page.screenshot({ path: test.info().outputPath('rename-error.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '重新命名', exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await page.getByRole('button', { name: '重新命名', exact: true }).click();
  await expect(dialog.getByLabel('產品名稱')).toHaveValue(title);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
});
