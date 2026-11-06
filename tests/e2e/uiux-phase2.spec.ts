import { test, expect, type Page } from '@playwright/test';
import { ADMIN, createProduct, expectNoPageOverflow, focused, login, openFirstProduct, unique } from './helpers';

/**
 * Phase 2 UI/UX checklist (2026-11-06): Personal (PE01-PE05), Product card details (PD01-PD04) and the
 * create Feedback dialog (FB01-FB09) at 1440 / 768 / 390, plus 320 px and a short window for the
 * dialog. Preview-level checks with screenshots, on the isolated E2E database.
 */
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath(`${name}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`), fullPage: true });
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAwAAAAJCAIAAACJ2loDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFElEQVQYlWMwTltFEDGMKmIgJggAdHuIRVoOAaQAAAAASUVORK5CYII=', 'base64');

test('PD01-PD04: name, then 目前產品 (selected card only), then YYYY / MM / DD in small text', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  await createProduct(page, unique('卡片日期'));
  await page.reload();
  const list = page.getByRole('list', { name: '產品' });
  const current = list.getByRole('listitem').filter({ has: page.locator('[aria-current="true"]') });
  const parts = await current.locator('a').evaluate((a) => [...a.children].map((c) => ({ text: (c as HTMLElement).innerText.trim(), top: c.getBoundingClientRect().top, size: getComputedStyle(c).fontSize })));
  expect(parts.map((p) => p.text)[1]).toBe('目前產品');
  expect(parts[2].text).toMatch(/^\d{4} \/ \d{2} \/ \d{2}$/);
  expect(parts[0].top).toBeLessThan(parts[1].top);
  expect(parts[1].top).toBeLessThan(parts[2].top);
  expect(parts[2].size).toBe('12px'); // --fs-small
  await expect(list.getByText('建立於')).toHaveCount(0);
  await expect(list.locator('[data-slot="badge"]')).toHaveCount(1);
  await expectNoPageOverflow(page);
  await shot(page, 'product-cards');
});

test('PE01-PE05: Personal toolbar, owner Select with avatar and Person tags, sort icon, add-column dialog', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'personal');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Personal');
  // PE01/PE02: no icon, no explanatory text
  await expect(main.getByRole('heading', { level: 1 }).locator('.mark')).toHaveCount(0);
  await expect(main.getByText('只屬於你的整理空間', { exact: false })).toHaveCount(0);
  await expect(main.getByText('私人欄位只有名稱', { exact: false })).toHaveCount(0);
  // PE03: the Select shows the person (avatar, name with 我, Person tags) inside, nothing duplicated outside
  const owner = main.getByRole('combobox', { name: /負責人/ });
  await expect(owner).toContainText('專案負責人（我）');
  await expect(owner.locator('.avatar')).toHaveCount(1);
  await expect(main.locator('.list-toolbar > .list-toolbar-start .avatar')).toHaveCount(1);
  await owner.click();
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();
  expect(await options.first().locator('.avatar').count()).toBe(1);
  await shot(page, 'personal-select');
  await page.keyboard.press('Escape');
  // PE04: sort icon (tooltip and name 排序) then 新增欄位; the old sort select and the inline form are gone
  const sort = main.getByRole('button', { name: '排序', exact: true });
  const add = main.getByRole('button', { name: '新增欄位' });
  const [s, a] = [(await sort.boundingBox())!, (await add.boundingBox())!];
  expect(s.x).toBeLessThan(a.x);
  await expect(main.getByLabel('新欄位名稱')).toHaveCount(0);
  await expect(main.getByRole('combobox', { name: '排序' })).toHaveCount(0);
  await sort.hover();
  await expect(page.getByRole('tooltip')).toHaveText('排序');
  await sort.click();
  await expect(page.getByRole('menuitemradio', { name: '自由排序' })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: '建立時間（新到舊）' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expectNoPageOverflow(page);
  await shot(page, 'personal');
  // PE05: the dialog, validation (empty name cannot be added), cancel returns focus to the button
  await add.click();
  const dlg = page.getByRole('dialog', { name: '新增欄位' });
  await expect(dlg.getByLabel('欄位名稱')).toBeFocused();
  await expect(dlg.getByRole('button', { name: '新增', exact: true })).toBeDisabled();
  await shot(page, 'personal-add-column');
  await dlg.getByRole('button', { name: '取消' }).click();
  await expect(dlg).toHaveCount(0);
  await expect.poll(() => focused(page)).toMatch(/新增欄位/);
  // a failure keeps the dialog and the typed name (mock 500)
  await page.route('**/personal/views/*/columns', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"伺服器暫時無法處理。"}}' }) : r.continue()));
  await add.click();
  const colName = unique('暫存欄').slice(0, 30);
  await dlg.getByLabel('欄位名稱').fill(colName);
  await dlg.getByRole('button', { name: '新增', exact: true }).click();
  await expect(dlg.getByRole('alert')).toBeVisible();
  await expect(dlg.getByLabel('欄位名稱')).toHaveValue(colName);
  await page.unroute('**/personal/views/*/columns');
  await dlg.getByRole('button', { name: '新增', exact: true }).click();
  await expect(dlg).toHaveCount(0);
  await expect(main.getByRole('listitem', { name: new RegExp(`^${colName}`) })).toBeVisible();
});

for (const size of [null, { width: 320, height: 640 }, { width: 390, height: 520 }] as const) {
  test(`FB01-FB09: create dialog layout${size ? ` at ${size.width}x${size.height}` : ''}`, async ({ page }, info) => {
    if (size && info.project.name !== 'mobile-390') test.skip();
    if (size) await page.setViewportSize(size);
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    await openFirstProduct(page, 'feedback');
    await page.getByRole('button', { name: '新增 Feedback' }).click();
    const d = page.getByRole('dialog', { name: '新增 Feedback' });
    await expect(d.getByLabel('標題')).toBeFocused();
    await d.getByLabel('標題').fill('登入後首頁載入過慢，需要確認快取設定與網路請求');
    await d.getByLabel('描述').fill('使用者回報從登入頁進入首頁要等待 5 秒以上。');
    await d.locator('input[type="file"]').setInputFiles([
      { name: 'one.png', mimeType: 'image/png', buffer: PNG }, { name: 'two.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await expect(d.getByRole('img', { name: /圖片 2/ })).toBeVisible();
    // order: title, description, images, pills, author, footer (FB01)
    const y = async (l: ReturnType<typeof d.locator>) => (await l.boundingBox())!.y;
    const order = [await y(d.getByLabel('標題')), await y(d.getByLabel('描述')), await y(d.getByRole('button', { name: /^新增圖片/ })), await y(d.getByRole('button', { name: /^狀態：/ })), await y(d.getByRole('button', { name: '建立' }))];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // FB04: image button tooltip; pills keep 32px and wrap; nothing overflows the page
    await d.getByRole('button', { name: /^新增圖片/ }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('新增圖片');
    for (const name of [/^狀態：/, /^類別：/, /^Person tag：/, /^加入標籤/]) expect((await d.getByRole('button', { name }).boundingBox())!.height).toBe(32);
    await expectNoPageOverflow(page);
    const box = (await d.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    // the footer stays reachable in a short window (the body scrolls)
    const create = d.getByRole('button', { name: '建立' });
    await expect(create).toBeInViewport();
    await shot(page, 'create-feedback');
    await d.getByRole('button', { name: /^加入標籤/ }).click();
    await expect(page.getByRole('dialog', { name: '加入標籤' })).toBeVisible();
    await shot(page, 'create-feedback-tags');
  });
}

test('the Roadmap 新增 Feedback opens the same dialog (FB09)', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'roadmaps');
  await page.getByRole('main').getByRole('button', { name: '新增 Feedback' }).click();
  const d = page.getByRole('dialog', { name: '新增 Feedback' });
  await expect(d.getByRole('button', { name: /^狀態：/ })).toBeVisible();
  await expect(d.getByRole('button', { name: /^新增圖片/ })).toBeVisible();
  expect(page.url()).toContain(`${ADMIN}/products/`);
});
