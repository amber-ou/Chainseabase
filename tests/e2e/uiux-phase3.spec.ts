import { test, expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ADMIN, createProduct, expectNoPageOverflow, login, openFirstProduct, unique } from './helpers';

/**
 * Phase 3 UI/UX checklist (2026-11-06): site-wide focus, Switch and button roles (III-01, III-03,
 * III-06, III-07), the create Feedback dialog (III-02, III-04, III-05) and the Roadmap board
 * (III-R01 to III-R08). Preview-level checks with screenshots, on the isolated E2E database.
 */
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath(`${name}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`), fullPage: true });
};
// a focus ring is either an outline or the shadcn ring (Tailwind's --tw-ring-shadow on the element)
const ring = (l: Locator) => l.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { outline: cs.outlineStyle === 'none' ? 'none' : `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`, shadow: cs.getPropertyValue('--tw-ring-shadow').trim() };
});
const hasRing = (r: { outline: string; shadow: string }) => r.outline !== 'none' || (r.shadow !== '' && !/^0 0 (#0000|transparent)$/.test(r.shadow) && !/^0 0 0 0/.test(r.shadow));
const bg = (l: Locator) => l.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color, getComputedStyle(el).borderTopColor]);

test('III-01: a mouse click shows no focus ring; keyboard focus does, in a neutral colour', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  const search = page.getByRole('searchbox', { name: '搜尋 Feedback' });
  await search.click();
  await expect(search).toBeFocused(); // the real focus and the caret stay
  expect(hasRing(await ring(search))).toBe(false);
  const add = page.getByRole('main').getByRole('button', { name: '新增 Feedback' });
  await add.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // keyboard: Tab from the search box lands on a control that shows a ring
  await search.click();
  await page.keyboard.press('Shift+Tab');
  const focused = page.locator(':focus');
  // the ring fades in (transition): wait for the settled state
  await expect.poll(async () => hasRing(await ring(focused))).toBe(true);
  await page.waitForTimeout(300);
  const r = await ring(focused);
  expect(r.outline === 'none' ? r.shadow : r.outline).not.toContain('29, 78, 216'); // not the old bright blue
  // a dialog opened with the mouse: its first field has focus but no ring
  await add.click();
  const title = page.getByRole('dialog', { name: '新增 Feedback' }).getByLabel('標題');
  await expect(title).toBeFocused();
  expect(hasRing(await ring(title))).toBe(false);
  await shot(page, 'focus-pointer-dialog');
});

test('III-03/III-06/III-07: shadcn Switch with its label on the right; black primary, grey cancel, red danger', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  await page.getByRole('main').getByRole('button', { name: '新增 Feedback' }).click();
  const d = page.getByRole('dialog', { name: '新增 Feedback' });
  const sw = d.getByRole('switch', { name: '新增多筆' });
  await expect(sw).toHaveAttribute('data-slot', 'switch');
  const label = d.getByText('新增多筆', { exact: true });
  expect((await sw.boundingBox())!.x).toBeLessThan((await label.boundingBox())!.x);
  expect(await bg(d.getByRole('button', { name: '建立' }))).toEqual(expect.arrayContaining(['rgb(24, 24, 27)', 'rgb(255, 255, 255)']));
  expect((await bg(d.getByRole('button', { name: '取消' })))[0]).toBe('rgb(236, 239, 243)');
  await d.getByRole('button', { name: '取消' }).click();
  // no old checkbox switch anywhere in the admin pages visited here
  await expect(page.locator('label.switch input[role="switch"]')).toHaveCount(0);
  // Roadmap publish switch: shadcn, label on the right
  await page.goto(page.url().replace(/\/feedback.*/, '/roadmaps'));
  const pub = page.getByRole('switch', { name: '發佈到前台' });
  await expect(pub).toHaveAttribute('data-slot', 'switch');
  expect((await pub.boundingBox())!.x).toBeLessThan((await page.getByText('發佈到前台', { exact: true }).boundingBox())!.x);
  // danger keeps its warning colour: the product delete confirmation
  await page.goto(`${ADMIN}/products`);
  await page.waitForURL(/dashboard/);
  const extra = await createProduct(page, unique('按鈕樣式'));
  await page.reload();
  await page.getByRole('button', { name: `${extra.name} 的操作`, exact: true }).click();
  await page.getByRole('menuitem', { name: '刪除產品' }).click();
  const alert = page.getByRole('alertdialog');
  await alert.getByRole('textbox').fill(extra.name);
  expect((await bg(alert.getByRole('button', { name: '永久刪除' })))[0]).toBe('rgb(196, 36, 42)');
  expect((await bg(alert.getByRole('button', { name: '取消' })))[0]).toBe('rgb(236, 239, 243)');
  await shot(page, 'buttons-danger');
  await alert.getByRole('button', { name: '取消' }).click();
});

test('III-02/III-04/III-05: no author row; chosen tags before ＋; clicking a chosen tag removes it', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  await page.getByRole('main').getByRole('button', { name: '新增 Feedback' }).click();
  const d = page.getByRole('dialog', { name: '新增 Feedback' });
  await expect(d.getByText('建立後記錄時間')).toHaveCount(0);
  const names = [unique('甲標').slice(0, 16), unique('乙標').slice(0, 16)];
  for (const name of names) {
    await d.getByRole('button', { name: /^加入標籤/ }).click();
    const picker = page.getByRole('dialog', { name: '加入標籤' });
    await picker.getByLabel('搜尋或輸入新標籤').fill(name);
    await picker.getByRole('button', { name: `建立「${name}」並加入` }).click();
    await expect(d.getByRole('button', { name: `取消選取：${name}` })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
  }
  // order: 狀態, 類別, Person tag, the chosen tags, then ＋ last
  const order = await d.getByRole('group', { name: 'Feedback 屬性' }).locator(':scope > button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(order[0]).toMatch(/^狀態：/);
  expect(order[1]).toMatch(/^類別：/);
  expect(order[2]).toMatch(/^Person tag：/);
  expect(order.slice(3, 5)).toEqual(names.map((n) => `取消選取：${n}`));
  expect(order.at(-1)).toMatch(/^加入標籤/);
  await shot(page, 'create-tags');
  // click removes (no × and no menu); Enter does too; focus moves to ＋; the shared tag still exists
  await expect(d.locator('.fbc-tag-remove')).toHaveCount(0);
  await d.getByRole('button', { name: `取消選取：${names[0]}` }).click();
  await expect(d.getByRole('button', { name: `取消選取：${names[0]}` })).toHaveCount(0);
  await d.getByRole('button', { name: `取消選取：${names[1]}` }).focus();
  await page.keyboard.press('Enter');
  await expect(d.getByRole('button', { name: `取消選取：${names[1]}` })).toHaveCount(0);
  await expect(d.getByRole('button', { name: /^加入標籤/ })).toBeFocused();
  await d.getByRole('button', { name: /^加入標籤/ }).click();
  await page.getByRole('dialog', { name: '加入標籤' }).getByLabel('搜尋或輸入新標籤').fill(names[0]);
  await expect(page.getByRole('dialog', { name: '加入標籤' }).getByRole('button', { name: names[0] })).toBeVisible();
});

async function roadmapProduct(page: Page) {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const product = await createProduct(page, unique('看板樣式'));
  const P = `${ADMIN}/api/v1/products/${product.id}`;
  for (const title of ['看板卡片甲', '看板卡片乙']) {
    const r = await page.request.post(`${P}/feedback`, { headers: { origin: ADMIN, 'idempotency-key': randomUUID() }, data: { title } });
    expect(r.status()).toBe(201);
  }
  // three categories, so the category board fits at 1440 and overflows on a narrow window
  for (const name of ['介面', '效能']) {
    const tax = await (await page.request.get(`${P}/taxonomy`)).json();
    const r = await page.request.post(`${P}/categories`, { headers: { origin: ADMIN }, data: { name, expectedRevision: tax.data.productRevision } });
    expect(r.status(), await r.text()).toBe(201);
  }
  // a category board next to the default status board
  expect((await page.request.post(`${P}/roadmaps`, { headers: { origin: ADMIN }, data: { name: '依類別（自訂括號）', dimension: 'category' } })).status()).toBe(201);
  await page.goto(`${ADMIN}/products/${product.id}/roadmaps`);
  await expect(page.getByRole('main').locator('.board-plain')).toBeVisible();
  return { product, P };
}

test('III-R01 to III-R08: Roadmap tabs, continuous board, widths, arrows, wheel, keys, resize, drag saves', async ({ page }, testInfo) => {
  const { P } = await roadmapProduct(page);
  const main = page.getByRole('main');
  // R01/R02: no dimension select; tab names only (a user's own brackets stay)
  await expect(main.getByRole('combobox', { name: /維度/ })).toHaveCount(0);
  await expect(main.getByRole('tab')).toHaveText(['產品進度', '依類別（自訂括號）']);
  // R03/R04: one white surface, rules between columns, no gaps; columns >= 333, cards >= 300
  const board = main.locator('.board-plain');
  const info = await board.evaluate((b) => {
    const cols = [...b.querySelectorAll<HTMLElement>(':scope > .column')];
    return {
      bg: getComputedStyle(b).backgroundColor, gap: getComputedStyle(b).columnGap,
      widths: cols.map((c) => Math.round(c.getBoundingClientRect().width)),
      rules: cols.map((c) => getComputedStyle(c).borderLeftWidth),
      cards: [...b.querySelectorAll<HTMLElement>('.kcard')].map((c) => Math.round(c.getBoundingClientRect().width)),
      heights: new Set(cols.map((c) => Math.round(c.getBoundingClientRect().height))).size,
    };
  });
  expect(info.bg).toBe('rgb(255, 255, 255)');
  expect(['0px', 'normal']).toContain(info.gap);
  expect(Math.min(...info.widths)).toBeGreaterThanOrEqual(333);
  expect(info.rules[0]).toBe('0px');
  expect(info.rules.slice(1).every((w) => w === '1px')).toBe(true);
  expect(Math.min(...info.cards)).toBeGreaterThanOrEqual(300);
  expect(info.heights).toBe(1); // same height
  await expectNoPageOverflow(page);
  // R05: five status columns do not fit at this width: arrows, left disabled at the start
  const scroller = main.locator('.board-frame .board-scroll');
  const left = main.getByRole('button', { name: '向左捲動看板' });
  const right = main.getByRole('button', { name: '向右捲動看板' });
  await expect(right).toBeEnabled();
  await expect(left).toBeDisabled();
  const colWidth = info.widths[0];
  await page.emulateMedia({ reducedMotion: 'reduce' }); // immediate scrolling, also checks R07
  await right.click();
  await expect.poll(() => scroller.evaluate((e) => Math.round(e.scrollLeft))).toBeGreaterThanOrEqual(colWidth - 2);
  await expect(left).toBeEnabled();
  // R07: keys on the container: Home / End, arrows; scrollbar hidden but the container scrolls
  await scroller.focus();
  await page.keyboard.press('End');
  await expect.poll(() => scroller.evaluate((e) => e.scrollWidth - e.clientWidth - e.scrollLeft)).toBeLessThanOrEqual(1);
  await expect(right).toBeDisabled();
  await page.keyboard.press('Home');
  await expect.poll(() => scroller.evaluate((e) => e.scrollLeft)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scroller.evaluate((e) => Math.round(e.scrollLeft))).toBeGreaterThanOrEqual(colWidth - 2);
  expect(await scroller.evaluate((e) => getComputedStyle(e).scrollbarWidth)).toBe('none');
  // R06: the wheel over the board moves it sideways; at the start, scrolling up is left to the page
  await scroller.evaluate((e) => { e.scrollLeft = 0; });
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => scroller.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  const prevented = await scroller.evaluate((e) => {
    e.scrollLeft = 0;
    const ev = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    e.dispatchEvent(ev);
    const atStart = ev.defaultPrevented;
    const zoom = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true });
    e.dispatchEvent(zoom);
    return { atStart, zoom: zoom.defaultPrevented };
  });
  expect(prevented).toEqual({ atStart: false, zoom: false });
  await shot(page, 'roadmap-board');
  // a board with fewer columns shares the width, without arrows; resizing re-checks (ResizeObserver)
  const size = page.viewportSize()!;
  await main.getByRole('tab', { name: '依類別（自訂括號）' }).click();
  await expect(main.locator('.board-plain > .column')).toHaveCount(3);
  await expect(main.locator('.board-plain .column').first()).toBeVisible();
  const few = await main.locator('.board-plain').evaluate((b) => [...b.querySelectorAll<HTMLElement>(':scope > .column')].map((c) => c.getBoundingClientRect().width));
  expect(few).toHaveLength(3);
  if (size.width >= 1024) {
    expect(Math.min(...few)).toBeGreaterThan(333);
    await expect(right).toHaveCount(0);
    await expect(left).toHaveCount(0);
    await page.setViewportSize({ width: 700, height: size.height });
    await expect(right).toBeVisible();
    await page.setViewportSize(size);
    await expect(right).toHaveCount(0);
  }
  await shot(page, 'roadmap-few-columns');
  // R08: drag still changes the board's dimension and is saved (HTML5 drag is a desktop pointer action;
  // touch and keyboard use the card menu, covered in admin.spec and keyboard.spec)
  if (testInfo.project.use.hasTouch) return;
  await main.getByRole('tab', { name: '產品進度' }).click();
  await scroller.evaluate((e) => { e.scrollLeft = 0; });
  const card = main.locator('.kcard', { hasText: '看板卡片甲' });
  const target = main.locator('.board-plain .column').nth(1);
  const targetName = (await target.getAttribute('aria-label'))!.split('，')[0];
  await card.dragTo(target.locator('.column-body'));
  await expect(page.getByText(new RegExp(`已將「看板卡片甲」移到「${targetName}」`))).toBeAttached();
  const rms = await (await page.request.get(`${P}/roadmaps`)).json();
  const boardData = await (await page.request.get(`${P}/roadmaps/${rms.data[0].id}/board?limit=50`)).json();
  const col = boardData.data.columns.find((c: { label: string }) => c.label === targetName);
  expect(col.cards.map((c: { title: string }) => c.title)).toContain('看板卡片甲');
});

test('III-R04: on a phone the cards keep 300px and the board scrolls inside itself', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-390');
  await roadmapProduct(page);
  const main = page.getByRole('main');
  const widths = await main.locator('.board-plain .kcard').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(300);
  await expectNoPageOverflow(page);
  // the toolbar stays usable (not clipped)
  for (const name of ['看板設定', '篩選']) await expect(main.getByRole('button', { name, exact: true })).toBeInViewport();
  await expect(main.getByRole('searchbox', { name: '搜尋看板 Feedback' })).toBeInViewport();
  await shot(page, 'roadmap-phone');
});
