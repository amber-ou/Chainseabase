import { test, expect, type Page } from '@playwright/test';
import { ADMIN, createProduct, expectNoAxeViolations, expectNoPageOverflow, listProducts, login, openFirstProduct, unique } from './helpers';

/**
 * Product deletion from the Product list (docs/change-requests/sidebar-position.md, phase 4).
 * Every test deletes products it created itself; 產品1 and other tests' data stay. Deleting every
 * product (the empty state) is product-empty.spec.ts, which runs after all other projects.
 */
const list = (page: Page) => page.getByRole('list', { name: '產品' });
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const row = (page: Page, name: string) => list(page).getByRole('link', { name: new RegExp(`^${esc(name)}`) });
const actions = (page: Page, name: string) => list(page).getByRole('button', { name: `${name} 的操作`, exact: true });
const dialog = (page: Page) => page.getByRole('alertdialog', { name: /^永久刪除產品『/ });
const confirmInput = (page: Page) => dialog(page).getByLabel('輸入產品名稱以確認');
const confirmButton = (page: Page) => dialog(page).getByRole('button', { name: '永久刪除' });

/** From the focused row menu button: Enter opens the menu on 重新命名, ArrowDown, Enter opens the dialog. */
async function openByKeyboard(page: Page) {
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: '重新命名' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '刪除產品' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmInput(page)).toBeFocused();
}

async function openDelete(page: Page, name: string) {
  await actions(page, name).click();
  await expect(page.getByRole('menuitem')).toHaveText(['重新命名', '刪除產品']);
  await page.getByRole('menuitem', { name: '刪除產品' }).click();
  await expect(dialog(page)).toBeVisible();
}

test('delete another product: exact name required, the row goes, the current product stays selected', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page);
  // a long name: it wraps in the dialog instead of pushing the buttons out
  const name = (unique('刪除其他') + '：跨部門協作平台與客戶回饋整合專案'.repeat(5)).slice(0, 100);
  const other = await createProduct(page, name);
  await page.reload();

  await openDelete(page, name);
  // the dialog names the product and says what is removed, permanently
  await expect(dialog(page).getByRole('heading')).toHaveText(`永久刪除產品『${name}』？`);
  await expect(dialog(page)).toContainText('永久刪除，無法在平台內復原');
  await expect(dialog(page)).toContainText(`需與「${name}」完全相同`);
  await expect(dialog(page)).toContainText('Feedback、留言、按讚、投票、Schedule 與 Roadmap 看板');
  await expect(dialog(page)).toContainText('Google 上的日曆、活動與分享權限');
  await expect(confirmInput(page)).toBeFocused();
  await expect(confirmButton(page)).toBeDisabled();
  // prefix, extra space, other case: still disabled
  for (const wrong of [name.slice(0, -1), name + ' ', ' ' + name, name.toUpperCase() === name ? name + 'x' : name.toUpperCase()]) {
    await confirmInput(page).fill(wrong);
    await expect(confirmButton(page)).toBeDisabled();
  }
  await expectNoPageOverflow(page);
  await page.screenshot({ path: test.info().outputPath('delete-dialog.png'), fullPage: true });
  await expectNoAxeViolations(page, 'delete dialog');
  await confirmInput(page).fill(name);
  await expect(confirmButton(page)).toBeEnabled();
  // a short window: the dialog scrolls inside the screen and every control stays reachable
  const full = page.viewportSize()!;
  await page.setViewportSize({ width: full.width, height: 480 });
  // measured once the resized window has been laid out
  await expect.poll(async () => (await dialog(page).boundingBox())!.y).toBeGreaterThanOrEqual(0);
  const box = (await dialog(page).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(480 + 1);
  expect(box.x + box.width).toBeLessThanOrEqual(full.width + 1);
  await confirmButton(page).scrollIntoViewIfNeeded();
  await expect(confirmButton(page)).toBeInViewport();
  await expect(dialog(page).getByRole('button', { name: '取消' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('delete-dialog-short.png') });
  await page.setViewportSize(full);
  await confirmButton(page).click();

  await expect(dialog(page)).toBeHidden();
  await expect(row(page, name)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `已永久刪除「${name}」` })).toBeVisible();
  // the selected product did not change, nor did the page
  expect(page.url()).toBe(base + '/dashboard');
  await expect(row(page, '產品1')).toHaveAttribute('aria-current', 'true');
  expect((await listProducts(page)).map((p) => p.id)).not.toContain(other.id);
  // focus does not fall to the page: it lands on a remaining row
  expect(await page.evaluate(() => document.activeElement?.closest('[aria-label="產品"]') !== null)).toBe(true);
});

test('delete the selected product: selection cleared, back to Product, old URLs and sections are closed', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const name = unique('刪除目前');
  const doomed = await createProduct(page, name);
  await page.goto(`${ADMIN}/products/${doomed.id}/dashboard`);
  await expect(row(page, name)).toHaveAttribute('aria-current', 'true');

  // requests made for the deleted product after the deletion (polling, sections) are recorded
  const after: string[] = [];
  let deletedAt = false;
  page.on('request', (r) => { if (deletedAt && r.url().includes(`/api/v1/products/${doomed.id}`)) after.push(`${r.method()} ${r.url()}`); });

  await openDelete(page, name);
  await confirmInput(page).fill(name);
  const done = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().endsWith(`/api/v1/products/${doomed.id}`));
  await confirmButton(page).click();
  expect((await done).status()).toBe(200);
  deletedAt = true;

  await expect(page).toHaveURL(`${ADMIN}/products`);
  await expect(page.getByRole('heading', { level: 1, name: 'Product' })).toBeFocused();
  await expect(page.getByText('尚未選取產品。請從清單選取產品，或新增產品。')).toBeVisible();
  await expect(row(page, name)).toHaveCount(0);
  await expect(list(page).locator('[aria-current]')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `已永久刪除「${name}」` })).toBeVisible();
  // product sections cannot open without a product; Product itself can
  const nav = page.viewportSize()!.width <= 1024 ? (await page.getByRole('button', { name: '開啟選單' }).click(), page.getByRole('dialog', { name: '選單' })) : page.locator('aside.sidebar');
  const navigation = nav.getByRole('navigation', { name: '後台導覽' });
  await expect(navigation.getByText('請先從 Product 選取產品')).toBeVisible();
  for (const label of ['Calendar', 'Feedback', 'Roadmap', 'User', 'Live Portal', 'Personal', 'Notification', 'Setting']) {
    await expect(navigation.getByText(label, { exact: true })).toHaveAttribute('aria-disabled', 'true');
  }
  await expect(navigation.getByRole('link')).toHaveText(['Product']);
  await expect(nav.locator('#product-switch')).toHaveValue('');
  await expectNoPageOverflow(page);
  await page.screenshot({ path: test.info().outputPath('deleted-current.png'), fullPage: true });
  await expectNoAxeViolations(page, 'product list with nothing selected');
  if (page.viewportSize()!.width <= 1024) await page.keyboard.press('Escape');

  // reopening /products keeps nothing selected; an old URL of the deleted product shows nothing of it
  await page.goto(`${ADMIN}/products`);
  await expect(page.getByText('尚未選取產品。請從清單選取產品，或新增產品。')).toBeVisible();
  await page.goto(`${ADMIN}/products/${doomed.id}/feedback`);
  await expect(page.getByText('找不到產品')).toBeVisible();
  await page.getByRole('link', { name: '返回 Product' }).click();
  await expect(page).toHaveURL(`${ADMIN}/products`);
  await page.waitForLoadState('networkidle');
  // nothing was requested for the deleted product after it was deleted (no polling, no section data)
  expect(after).toEqual([]);

  // selecting a product from the list selects it again everywhere
  await row(page, '產品1').click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\/dashboard$/);
  await expect(row(page, '產品1')).toHaveAttribute('aria-current', 'true');
  // the public site no longer serves it
  const pub = await page.request.get(`${ADMIN}/api/v1/public/products/${doomed.slug}`);
  expect(pub.status()).toBe(404);
});

test('keyboard only: open from the row menu, Enter never submits, Tab order, Escape cancels and returns focus', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test');
  await openFirstProduct(page);
  const name = unique('鍵盤刪除');
  const kept = await createProduct(page, name);
  await page.reload();
  await actions(page, name).focus();
  await openByKeyboard(page);
  await page.keyboard.type(name);
  // Enter in the field does not delete
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog(page).getByRole('button', { name: '取消' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirmButton(page)).toBeFocused();
  // focus stays inside the dialog
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('[role="alertdialog"]') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(actions(page, name)).toBeFocused();
  // 取消 also changes nothing, and reopening starts empty
  await openByKeyboard(page);
  await expect(confirmInput(page)).toHaveValue('');
  await dialog(page).getByRole('button', { name: '取消' }).click();
  await expect(actions(page, name)).toBeFocused();
  expect((await listProducts(page)).map((p) => p.id)).toContain(kept.id);

  // and the deletion itself by keyboard
  await openByKeyboard(page);
  await page.keyboard.type(name);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeHidden();
  await expect(row(page, name)).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.closest('[aria-label="產品"]') !== null)).toBe(true);
});

test('pending: one request only, cannot close; refused, failed and unknown results never show success', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test');
  await openFirstProduct(page);
  const name = unique('錯誤處理');
  const target = await createProduct(page, name);
  await page.reload();
  const path = `**/api/v1/products/${target.id}`;
  let deletes = 0;
  let mode: 'slow' | '409' | '400' | 'network' | 'lost' = 'slow';
  await page.route(path, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    deletes++;
    if (mode === 'slow') { await new Promise((r) => setTimeout(r, 1500)); return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'x', fieldErrors: {}, retryable: true, requestId: '' } }) }); }
    if (mode === '409') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REVISION_CONFLICT', message: 'conflict', fieldErrors: {}, retryable: false, requestId: '' } }) });
    if (mode === '400') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'x', fieldErrors: { confirmName: '名稱不一致' }, retryable: false, requestId: '' } }) });
    if (mode === 'network') return route.abort('connectionreset');
    // 'lost': the deletion really happens on the server, but the response never arrives
    await route.fetch();
    return route.abort('connectionreset');
  });

  // slow then a 5xx: busy while pending, a second click sends nothing, Escape and 取消 do not close
  await openDelete(page, name);
  await confirmInput(page).fill(name);
  await confirmButton(page).click();
  const busy = dialog(page).getByRole('button', { name: '刪除中…' });
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  await busy.click({ force: true });
  await page.keyboard.press('Escape');
  await dialog(page).getByRole('button', { name: '取消' }).click({ force: true });
  await expect(dialog(page)).toBeVisible();
  await expectNoPageOverflow(page);
  await page.screenshot({ path: test.info().outputPath('delete-pending.png'), fullPage: true });
  // a 5xx is an unknown result: checked against the list (product still there) → not deleted, may retry
  await expect(dialog(page).getByRole('alert')).toContainText('未能確認刪除結果：產品仍在清單中，目前未刪除。');
  expect(deletes).toBe(1);
  // (the list behind the modal is hidden from the accessibility tree: checked through the API)
  expect((await listProducts(page)).map((p) => p.id)).toContain(target.id);

  // network failure: same check, same honest message
  mode = 'network';
  await confirmButton(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('產品仍在清單中，目前未刪除');
  await expect(page.getByRole('status').filter({ hasText: '已永久刪除' })).toHaveCount(0);

  // name refused by the server
  mode = '400';
  await confirmButton(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('輸入的名稱與產品名稱不一致，產品未刪除。');

  // stale confirmation: refused, cannot be retried from this dialog
  mode = '409';
  await confirmButton(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('這次確認已失效，產品未刪除');
  await expect(confirmButton(page)).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('delete-conflict.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(row(page, name)).toBeVisible();
  expect((await listProducts(page)).map((p) => p.id)).toContain(target.id);

  // the response is lost after the server deleted it: the check finds it gone and reports the deletion
  mode = 'lost';
  await openDelete(page, name);
  await confirmInput(page).fill(name);
  await confirmButton(page).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: `已永久刪除「${name}」` })).toBeVisible();
  await expect(row(page, name)).toHaveCount(0);
  expect((await listProducts(page)).map((p) => p.id)).not.toContain(target.id);
});

test('a product someone else already deleted: the dialog says so and the list updates', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test');
  await openFirstProduct(page);
  const name = unique('已被刪除');
  const target = await createProduct(page, name);
  await page.reload();
  await openDelete(page, name);
  // deleted from elsewhere (another member) while this dialog is open
  const r = await page.request.delete(`${ADMIN}/api/v1/products/${target.id}`, { headers: { origin: ADMIN, 'if-match': `"${target.revision}"` }, data: { confirmName: name } });
  expect(r.status()).toBe(200);
  await confirmInput(page).fill(name);
  await confirmButton(page).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: `「${name}」已不存在，可能已被其他人刪除` })).toBeVisible();
  await expect(row(page, name)).toHaveCount(0);
});
