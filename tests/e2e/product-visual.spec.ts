import { test, expect, type Page } from '@playwright/test';
import { ADMIN, expectNoPageOverflow, listProducts, login, openFirstProduct } from './helpers';

/**
 * Product page states, screenshotted at 1440 / 768 / 390 for the phase 6 visual review
 * (docs/change-requests/sidebar-position.md). The empty list is a MOCK (GET /products answers [])
 * so other tests keep their products; every other state is the real app.
 */
const SAMPLE = ['行動 App', '官方網站'];
// dialogs and menus animate in for about 200ms: shoot the settled state
const shot = async (page: Page, name: string) => { await page.waitForTimeout(400); await page.screenshot({ path: test.info().outputPath(`${name}-${page.viewportSize()!.width}.png`), fullPage: true }); };

async function withSampleProducts(page: Page) {
  const have = (await listProducts(page)).map((p) => p.name);
  for (const name of SAMPLE.filter((n) => !have.includes(n))) {
    const r = await page.request.post(`${ADMIN}/api/v1/products`, { headers: { origin: ADMIN }, data: { name } });
    expect(r.status()).toBe(201);
  }
}

test('Product states for the visual review', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  await withSampleProducts(page);
  await page.reload();
  const list = page.getByRole('list', { name: '產品' });
  await expect(list.getByRole('link', { name: /^產品1/ })).toHaveAttribute('aria-current', 'true');
  await expectNoPageOverflow(page);
  // the page is built from the installed shadcn/ui components, and no legacy rule overrides them
  const main = page.getByRole('main');
  await expect(main.locator('[data-slot="card"] ul[aria-label="產品"]')).toHaveCount(1);
  // shadcn Button rendered through DialogTrigger asChild (the trigger's data-slot wins), with the Button classes
  await expect(main.getByRole('button', { name: '新增產品', exact: true })).toHaveAttribute('data-slot', 'dialog-trigger');
  await expect(main.getByRole('button', { name: '新增產品', exact: true })).toHaveClass(/bg-primary/);
  await expect(main.locator('[data-slot="badge"]')).toHaveText('目前產品');
  await expect(list.getByRole('button', { name: '行動 App 的操作', exact: true })).toHaveAttribute('data-slot', 'dropdown-menu-trigger');
  const style = await page.evaluate(() => {
    const css = (sel: string) => getComputedStyle(document.querySelector(sel)!);
    const h1 = css('main h1');
    const add = [...document.querySelectorAll('main button')].find((b) => b.textContent?.includes('新增產品'))!;
    const card = document.querySelector('main [data-slot="card"]')!;
    return {
      h1: [h1.fontSize, h1.fontWeight], addHeight: add.getBoundingClientRect().height, addBg: getComputedStyle(add).backgroundColor,
      cardShadow: getComputedStyle(card).boxShadow, cardWidth: card.getBoundingClientRect().width,
      rowHeight: (document.querySelector('main ul[aria-label="產品"] > li') as HTMLElement).getBoundingClientRect().height,
    };
  });
  const width = page.viewportSize()!.width;
  expect(style.h1).toEqual([width < 640 ? '20px' : '24px', '600']);
  expect(style.addHeight).toBe(36);
  expect(style.addBg).toBe('rgb(20, 20, 20)'); // --primary, near-black
  // a border or a shadow, never both: every shadow layer Tailwind composes is transparent
  expect(style.cardShadow === 'none' || /^(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?)+$/.test(style.cardShadow)).toBe(true);
  expect(style.cardWidth).toBeLessThanOrEqual(768); // a short list does not span the canvas
  expect(style.rowHeight).toBeGreaterThanOrEqual(56);
  await shot(page, 'product-list');

  // row menu
  await list.getByRole('button', { name: '行動 App 的操作', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '刪除產品' })).toBeVisible();
  await shot(page, 'product-menu');
  await page.keyboard.press('Escape');

  // create
  await page.getByRole('button', { name: '新增產品', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '新增產品' })).toBeVisible();
  await shot(page, 'product-create');
  await page.keyboard.press('Escape');

  // rename
  await list.getByRole('button', { name: '行動 App 的操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重新命名' }).click();
  await expect(page.getByRole('dialog', { name: '重新命名產品' })).toBeVisible();
  await shot(page, 'product-rename');
  await page.keyboard.press('Escape');

  // delete confirmation (opened only; cancelled)
  await list.getByRole('button', { name: '行動 App 的操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '刪除產品' }).click();
  const del = page.getByRole('alertdialog');
  await expect(del).toBeVisible();
  await del.getByRole('textbox').fill('行動 App');
  await expect(del.getByRole('button', { name: '永久刪除' })).toBeEnabled();
  await shot(page, 'product-delete');
  await del.getByRole('button', { name: '取消' }).click();
  await expect(del).toBeHidden();

  // nothing selected
  await page.evaluate(() => localStorage.setItem('csb:lastProduct', ''));
  await page.goto(`${ADMIN}/products`);
  await expect(page.getByRole('main').getByText(/^尚未選取產品/)).toBeVisible();
  await expectNoPageOverflow(page);
  await shot(page, 'product-unselected');

  // no products at all (mock)
  await page.route('**/api/v1/products', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }) : r.continue()));
  await page.goto(`${ADMIN}/products`);
  await expect(page.getByRole('main').getByText('尚無產品', { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await shot(page, 'product-empty');
});
