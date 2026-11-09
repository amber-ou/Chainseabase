import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ADMIN, createProduct, expectNoPageOverflow, focused, login, openFirstProduct, unique } from './helpers';

/**
 * UI/UX adjustment checklist of 2026-11-06 (docs/change-requests/sidebar-position.md): account entry
 * and Setting (A01–A04), Product cards (P01–P04), the admin Feedback toolbar (F01–F09) and Roadmap
 * (R01–R17). Preview-level checks at 1440 / 768 / 390 on the isolated E2E database; a product of its
 * own is created where a test needs many tabs or items, so other specs keep their data.
 */
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath(`${name}-${page.viewportSize()!.width}.png`), fullPage: true });
};
const phoneNav = (page: Page) => page.viewportSize()!.width <= 1024;
async function sidebar(page: Page) {
  if (phoneNav(page)) {
    await page.getByRole('button', { name: '開啟選單' }).click();
    return page.getByRole('dialog', { name: '選單' });
  }
  return page.locator('aside.sidebar');
}
async function addFeedback(page: Page, productId: string, title: string, description = `${title}的描述`) {
  const r = await page.request.post(`${ADMIN}/api/v1/products/${productId}/feedback`, {
    headers: { origin: ADMIN, 'idempotency-key': randomUUID() }, data: { title, description },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).data as { id: string };
}

test('A01–A04: the account area opens Setting (with or without a product); logout is in Setting', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page);
  let nav = await sidebar(page);
  // A02: no separate Setting item and no logout button in the sidebar
  await expect(nav.locator('.nav-item', { hasText: /^Setting$/ })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: '登出' })).toHaveCount(0);
  // A01: avatar, name and e-mail are one link straight to Setting (no menu in between)
  const entry = nav.getByRole('link', { name: /專案負責人.*lead@e2e\.test.*開啟 Setting/ });
  await expect(entry).toBeVisible();
  await entry.getByText('lead@e2e.test').click();
  await page.waitForURL(`${base}/settings`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Setting');
  await expect(page.getByRole('menu')).toHaveCount(0);
  nav = await sidebar(page);
  await expect(nav.getByRole('link', { name: /開啟 Setting/ })).toHaveAttribute('aria-current', 'page');
  if (phoneNav(page)) await page.getByRole('button', { name: '關閉選單' }).click();
  // A03: logout is in its own section, apart from the save buttons
  const account = page.getByRole('region', { name: '帳號' });
  await expect(account.getByRole('button', { name: '登出' })).toBeVisible();
  await expect(account.getByRole('button', { name: /儲存/ })).toHaveCount(0);
  await expectNoPageOverflow(page);
  await shot(page, 'setting');

  // A04: with no product selected, the account entry still opens Setting (account settings only)
  await page.evaluate(() => localStorage.setItem('csb:lastProduct', ''));
  await page.goto(`${ADMIN}/products`);
  await expect(page.getByRole('main').getByText(/^尚未選取產品/)).toBeVisible();
  nav = await sidebar(page);
  await nav.getByRole('link', { name: /開啟 Setting/ }).click();
  await page.waitForURL(`${ADMIN}/products/settings`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Setting');
  await expect(page.getByLabel('顯示名稱')).toHaveValue('專案負責人');
  await expect(page.getByRole('tab', { name: '管理標籤' })).toHaveCount(0);
  await expectNoPageOverflow(page);
  await shot(page, 'setting-no-product');

  // logout keeps its behaviour: the session ends and the next admin page goes to Login
  await page.getByRole('region', { name: '帳號' }).getByRole('button', { name: '登出' }).click();
  await page.waitForURL(/\/login/);
  await page.goto(`${ADMIN}/products`);
  await page.waitForURL(/\/login\?returnTo=%2Fproducts/);
});

test('P01–P04: one card per product; the card switches product, its menu does not', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page);
  const other = await createProduct(page, unique('卡片產品'));
  await page.reload();
  const list = page.getByRole('list', { name: '產品' });
  const items = list.getByRole('listitem');
  await expect(items.first().locator('[data-slot="card"]')).toHaveCount(1);
  await expect(list.getByText(/\/p\//)).toHaveCount(0); // P02: no portal address
  await expect(list.getByText(/^\d{4} \/ \d{2} \/ \d{2}$/).first()).toBeVisible(); // phase 2 PD02
  await expect(list.locator('[data-slot="badge"]')).toHaveText('目前產品');
  // P04: opening the card menu (and closing it) changes nothing
  const card = items.filter({ hasText: other.name });
  await card.getByRole('button', { name: `${other.name} 的操作`, exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '重新命名' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '刪除產品' })).toBeVisible();
  await shot(page, 'product-cards-menu');
  await page.keyboard.press('Escape');
  expect(page.url()).toBe(`${base}/dashboard`);
  // the main area switches
  await card.getByRole('link').click();
  await page.waitForURL(`${ADMIN}/products/${other.id}/dashboard`);
  await expect(page.getByRole('list', { name: '產品' }).getByRole('link', { name: new RegExp(`^${other.name}`) })).toHaveAttribute('aria-current', 'true');
  await expectNoPageOverflow(page);
  await shot(page, 'product-cards');
});

test('F01–F09: Feedback toolbar, Filter popover, search and grey empty states', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const product = await createProduct(page, unique('Feedback 工具列'));
  await page.goto(`${ADMIN}/products/${product.id}/feedback`);
  const main = page.getByRole('main');
  // F07: nothing yet: grey text only, no box, no 新增第一筆
  await expect(main.getByRole('status').filter({ hasText: '這個產品還沒有 Feedback。' })).toBeVisible();
  await expect(main.getByRole('button', { name: '新增第一筆' })).toHaveCount(0);
  // F02: one 新增 Feedback, in the toolbar (not in the page header)
  await expect(main.getByRole('button', { name: '新增 Feedback' })).toHaveCount(1);
  await expect(main.locator('.page-head').getByRole('button')).toHaveCount(0);
  const title = unique('工具列搜尋');
  await addFeedback(page, product.id, title);
  await page.reload();
  const create = main.getByRole('button', { name: '新增 Feedback' });
  const filter = main.getByRole('button', { name: '篩選', exact: true });
  const search = main.getByRole('searchbox', { name: '搜尋 Feedback' });
  await expect(search).toHaveAttribute('placeholder', '搜尋標題或描述…');
  // F05: shadcn Input Group with a search icon
  await expect(search.locator('xpath=ancestor::*[@data-slot="input-group"]').locator('svg').first()).toBeVisible();
  // F06/F08: no panel around the toolbar and no item count
  await expect(main.locator('.toolbar-panel')).toHaveCount(0);
  await expect(main.getByText(/共 \d+ 筆/)).toHaveCount(0);
  // F01/F09: create on the left; Filter then search on the right (wrapping on phones)
  const [c, f, s] = [(await create.boundingBox())!, (await filter.boundingBox())!, (await search.boundingBox())!];
  const content = (await main.locator('.list-toolbar').boundingBox())!;
  expect(Math.abs(c.x - content.x)).toBeLessThanOrEqual(1);
  expect(f.x).toBeLessThan(s.x);
  if (page.viewportSize()!.width > 640) {
    expect(Math.abs(c.y + c.height / 2 - (s.y + s.height / 2))).toBeLessThanOrEqual(2);
  } else {
    expect(s.width).toBeGreaterThanOrEqual(200);
  }
  await expectNoPageOverflow(page);
  await shot(page, 'feedback-toolbar');
  // F04: icon-only Filter with a 篩選 tooltip
  await filter.hover();
  await expect(page.getByRole('tooltip')).toHaveText('篩選');
  // F03: category and tags in one popover
  await filter.click();
  const pop = page.getByRole('dialog', { name: '篩選' });
  await expect(pop.getByRole('group', { name: '類別' }).getByRole('radio', { name: '全部類別' })).toBeChecked();
  await expect(pop.getByRole('group', { name: '標籤' })).toBeVisible();
  await shot(page, 'feedback-filter');
  await pop.getByRole('group', { name: '類別' }).getByRole('radio').nth(1).check();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  // focus back on the Filter button, whose name now says a filter is applied
  await expect(main.getByRole('button', { name: '篩選（已套用篩選）' })).toBeFocused();
  await page.waitForURL(/category=/);
  await main.getByRole('button', { name: /^篩選/ }).click();
  await pop.getByRole('button', { name: '清除篩選' }).click();
  await page.keyboard.press('Escape');
  // F05: search keeps its behaviour; F07: no results reads differently from no data
  await search.fill(title);
  await expect(main.getByRole('button', { name: title })).toBeVisible();
  await search.fill(unique('沒有這筆'));
  await expect(main.getByRole('status').filter({ hasText: '沒有符合目前搜尋或篩選條件的 Feedback' })).toBeVisible();
  const color = await main.getByRole('status').filter({ hasText: '沒有符合' }).evaluate((e) => getComputedStyle(e).color);
  expect(color).toBe('rgb(85, 98, 116)'); // --muted: 5.8:1 on the page background
  await shot(page, 'feedback-no-results');
});

test('R01–R17: Roadmap tabs, toolbar, publish switch, filters and settings', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const product = await createProduct(page, unique('Roadmap 清單'));
  const P = `${ADMIN}/api/v1/products/${product.id}`;
  const hit = unique('路線搜尋');
  await addFeedback(page, product.id, hit);
  await addFeedback(page, product.id, unique('其他卡片'), '描述含有關鍵詞藍鯨');
  // many boards, so the tab row has to scroll (R05)
  // phase 3 removed the dimension hint from the tabs: longer names keep the row wider than the page
  for (let i = 1; i <= 9; i++) {
    const r = await page.request.post(`${P}/roadmaps`, { headers: { origin: ADMIN }, data: { name: `看板 ${i} 第四季規劃`, dimension: i % 3 === 0 ? 'category' : 'status' } });
    expect(r.status(), await r.text()).toBe(201);
  }
  await page.goto(`${ADMIN}/products/${product.id}/roadmaps`);
  const main = page.getByRole('main');
  await expect(main.getByRole('tab').first()).toBeVisible();
  // R01: no icon in the title
  await expect(main.getByRole('heading', { level: 1 }).locator('.mark')).toHaveCount(0);
  // R02 replaced by RM-01/02 (2026-11-09): no 新增 Feedback above the tabs; each column header has its own ＋
  await expect(main.getByRole('button', { name: '新增 Feedback', exact: true })).toHaveCount(0);
  await expect(main.getByRole('button', { name: /^新增 Feedback 至〔/ }).first()).toBeVisible();
  const tabsRow = main.locator('.board-tabs');
  // R03: 新增 Roadmap is the last thing in the tab row, right after the last tab
  const add = tabsRow.getByRole('button', { name: '新增 Roadmap' });
  expect(await tabsRow.evaluate((row) => row.lastElementChild?.textContent)).toContain('新增 Roadmap');
  const tabs = main.getByRole('tab');
  // R04/R05: no vertical scrolling in the row; sideways inside the row only; the page does not overflow
  const metrics = await tabsRow.evaluate((row) => ({ sh: row.scrollHeight, ch: row.clientHeight, sw: row.scrollWidth, cw: row.clientWidth }));
  expect(metrics.sh).toBeLessThanOrEqual(metrics.ch);
  expect(metrics.sw).toBeGreaterThan(metrics.cw);
  await expectNoPageOverflow(page);
  await add.scrollIntoViewIfNeeded();
  await expect(add).toBeInViewport();
  const lastTab = (await tabs.last().boundingBox())!, addBox = (await add.boundingBox())!;
  expect(addBox.x - (lastTab.x + lastTab.width)).toBeLessThanOrEqual(8);
  // keyboard: arrows move along the tabs
  await tabs.first().focus();
  await page.keyboard.press('End');
  await expect(tabs.last()).toBeFocused();
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await shot(page, 'roadmap');

  // R06: Switch, 發佈到前台 and the settings icon on the left; Filter then search on the right
  const sw = main.getByRole('switch', { name: '發佈到前台' });
  const settings = main.getByRole('button', { name: '看板設定' });
  const filter = main.getByRole('button', { name: '篩選', exact: true });
  const search = main.getByRole('searchbox', { name: '搜尋看板 Feedback' });
  const [a, b, c, d] = [(await sw.boundingBox())!, (await settings.boundingBox())!, (await filter.boundingBox())!, (await search.boundingBox())!];
  expect(a.x).toBeLessThan(b.x);
  expect(c.x).toBeLessThan(d.x);
  // R08: no separate published label; R12: no board description; R10: no separate sort select
  await expect(main.getByText('已發布到前台')).toHaveCount(0);
  await expect(main.getByText('依狀態分欄的預設看板')).toHaveCount(0);
  await expect(main.getByRole('combobox', { name: '排序方式' })).toHaveCount(0);
  // R07/R08: the switch saves at once; a failure puts it back and says why
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(sw).toBeEnabled();
  const boardId = new URL(page.url()).searchParams.get('board') ?? (await (await page.request.get(`${P}/roadmaps`)).json()).data[0].id;
  expect((await (await page.request.get(`${P}/roadmaps`)).json()).data.find((r: { id: string }) => r.id === boardId).portalPublished).toBe(true);
  await page.route(`**/api/v1/products/${product.id}/roadmaps/*`, (r) => (r.request().method() === 'PATCH'
    ? new Promise((done) => setTimeout(done, 400)).then(() => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"伺服器暫時無法處理。"}}' }))
    : r.continue()));
  await sw.click();
  await expect(sw).toBeDisabled(); // saving: no second toggle
  await expect(main.getByRole('alert')).toContainText('發佈狀態未變更');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.unroute(`**/api/v1/products/${product.id}/roadmaps/*`);
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  // a category board cannot be published (unchanged rule): the switch is disabled and says why
  await tabs.nth(3).click();
  await expect(main.getByRole('switch', { name: '發佈到前台' })).toBeDisabled();
  await expect(main.getByText('（僅狀態看板）')).toBeVisible();
  await tabs.first().click();

  // R09: settings is an icon with a tooltip
  await settings.hover();
  await expect(page.getByRole('tooltip')).toHaveText('看板設定');
  // R10: Filter popover with category, tags and the existing sort options
  await filter.click();
  const pop = page.getByRole('dialog', { name: '篩選' });
  for (const g of ['類別', '標籤', '排序']) await expect(pop.getByRole('group', { name: g })).toBeVisible();
  await expect(pop.getByRole('radio', { name: '自由排序' })).toBeVisible();
  await expect(pop.getByRole('radio', { name: '建立時間（新到舊）' })).toBeVisible();
  await shot(page, 'roadmap-filter');
  await page.keyboard.press('Escape');
  // R11: search by title or description, display only
  await search.fill(hit);
  await expect(main.getByRole('button', { name: hit, exact: true })).toBeVisible();
  await expect(main.locator('.kcard')).toHaveCount(1);
  await search.fill('藍鯨');
  await expect(main.locator('.kcard')).toHaveCount(1);
  await expect(main.locator('.kcard')).not.toContainText(hit);
  await search.fill(unique('不存在'));
  await expect(main.getByText('沒有符合目前搜尋或篩選條件的 Feedback')).toBeVisible();
  await search.fill('');
  await expect(main.locator('.kcard')).toHaveCount(2);
  // R17: the columns have no background, border or rounded box; the cards keep theirs
  const style = await main.locator('.board .column').first().evaluate((col) => {
    const cs = getComputedStyle(col);
    const card = col.querySelector('.kcard');
    return { bg: cs.backgroundColor, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, cardBorder: card ? getComputedStyle(card).borderTopWidth : '1px' };
  });
  expect(style).toEqual({ bg: 'rgba(0, 0, 0, 0)', border: '0px', radius: '0px', cardBorder: '1px' });
  await expect(main.locator('.board .column .mark').first()).toBeVisible(); // the colour marks stay
  await expectNoPageOverflow(page);
  await shot(page, 'roadmap-board');

  // R12–R16: settings dialog
  await settings.click();
  const dlg = page.getByRole('dialog', { name: '看板設定' });
  for (const gone of ['描述', 'Tab 順序', '往前移', '往後移', '不可修改', '由 Setting 管理']) await expect(dlg.getByText(gone)).toHaveCount(0);
  await expect(dlg.getByRole('switch')).toHaveCount(0);
  await expect(dlg.getByRole('button', { name: /^上移「|^下移「/ })).toHaveCount(0);
  await expect(dlg.getByRole('textbox', { name: /^名稱/ })).toHaveAttribute('data-slot', 'input');
  const before = (await (await page.request.get(`${P}/roadmaps/${boardId}/columns`)).json()).data.map((x: { label: string }) => x.label) as string[];
  const handles = dlg.getByRole('button', { name: /^調整「.+」的順序/ });
  await expect(handles).toHaveCount(before.length);
  // keyboard: ArrowDown on the handle moves the row, focus stays on the handle
  await handles.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(dlg.getByText(`「${before[0]}」移到第 2 個位置`)).toBeAttached();
  await expect.poll(() => focused(page)).toMatch(new RegExp(`調整「${before[0]}」的順序，目前第 2 個`));
  // typing in a name does not drag; 取消 discards the new order
  await dlg.getByLabel(`「${before[1]}」欄位名稱`).click();
  await shot(page, 'roadmap-settings');
  await dlg.getByRole('button', { name: '取消' }).click();
  expect((await (await page.request.get(`${P}/roadmaps/${boardId}/columns`)).json()).data.map((x: { label: string }) => x.label)).toEqual(before);
  // pointer drag (mouse here; the handle is touch-action: none for touch), then 儲存
  await settings.click();
  const h0 = (await dlg.getByRole('button', { name: /^調整「.+」的順序/ }).first().boundingBox())!;
  const h2 = (await dlg.getByRole('button', { name: /^調整「.+」的順序/ }).nth(2).boundingBox())!;
  await page.mouse.move(h0.x + h0.width / 2, h0.y + h0.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(h0.x + h0.width / 2, h0.y + h0.height / 2 + ((h2.y - h0.y + 6) * i) / 8);
  await page.mouse.up();
  await expect(dlg.getByText(`「${before[0]}」移到第 3 個位置`)).toBeAttached();
  await expect(page.getByRole('dialog', { name: `移動「${before[0]}」` })).toHaveCount(0); // a drag does not open the move menu
  // single pointer without dragging (WCAG 2.5.7): a tap on the handle opens the move menu
  await dlg.getByRole('button', { name: /^調整「.+」的順序/ }).first().click();
  const moveMenu = page.getByRole('dialog', { name: /^移動「/ });
  await expect(moveMenu.getByRole('button', { name: '移到最前' })).toBeDisabled();
  await moveMenu.getByRole('button', { name: '下移' }).click();
  await dlg.getByRole('button', { name: '儲存' }).click();
  await expect(dlg).toBeHidden();
  const after = (await (await page.request.get(`${P}/roadmaps/${boardId}/columns`)).json()).data.map((x: { label: string }) => x.label);
  // drag: [0,1,2,…] → [1,2,0,…]; then 下移 on the first row → [2,1,0,…]
  expect(after).toEqual([before[2], before[1], before[0], ...before.slice(3)]);
});
