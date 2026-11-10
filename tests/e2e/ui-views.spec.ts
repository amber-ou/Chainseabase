import { test, expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ADMIN, createProduct, expectNoPageOverflow, login, openEdit, openFirstProduct, unique } from './helpers';

/**
 * Feedback attributes, board masks and shared Feedback tables (2026-11-10, ATTR-01..07 with the
 * instant-save rules, MASK-01..07, LIST-01..15). Real rendering and behaviour on the isolated E2E
 * database; screenshots are written for review only.
 */
const TAG = process.env.SHOT_TAG ?? 'after';
const shot = async (page: Page, name: string, target?: Locator) => {
  await page.waitForTimeout(250);
  const path = test.info().outputPath(`${TAG}-${name}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`);
  if (target) await target.screenshot({ path, animations: 'disabled' });
  else await page.screenshot({ path, fullPage: true, animations: 'disabled' });
};

async function setup(page: Page) {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const product = await createProduct(page, unique('表格'));
  const P = `${ADMIN}/api/v1/products/${product.id}`;
  const tax = async () => (await (await page.request.get(`${P}/taxonomy`)).json()).data;
  const tagId = (await (await page.request.post(`${P}/tags`, { headers: { origin: ADMIN }, data: { name: 'UIUX', groupId: null, expectedRevision: (await tax()).productRevision } })).json()).data.tag.id as string;
  const make = async (title: string, extra: Record<string, unknown> = {}) => {
    const r = await page.request.post(`${P}/feedback`, { headers: { origin: ADMIN, 'idempotency-key': randomUUID() }, data: { title, description: `${title} 的描述`, ...extra } });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()).data as { id: string; revision: number };
  };
  const get = async (id: string) => (await (await page.request.get(`${P}/feedback/${id}`)).json()).data;
  return { product, P, tax, tagId, make, get };
}
const plusDialog = (page: Page) => page.getByRole('dialog', { name: '加入標籤、優先級或版本' });

test('ATTR-01..05: create — ＋ holds 優先級 and 版本, their pills sit left of ＋; 內部／公開 and 新增多筆 on the footer left', async ({ page }) => {
  const { product, P } = await setup(page);
  await page.goto(`${ADMIN}/products/${product.id}/feedback`);
  await page.getByRole('main').getByRole('button', { name: '新增 Feedback' }).click();
  const d = page.getByRole('dialog', { name: '新增 Feedback' });
  // no second settings row; no priority pill until one is chosen
  await expect(d.getByRole('group', { name: '其他設定' })).toHaveCount(0);
  await expect(d.getByRole('button', { name: /^優先級：/ })).toHaveCount(0);
  await d.getByLabel('標題').fill('屬性入口');
  await d.getByRole('button', { name: /^加入標籤、優先級或版本/ }).click();
  await expect(plusDialog(page).getByRole('button', { name: /^優先級/ })).toBeVisible();
  await expect(plusDialog(page).getByRole('button', { name: /^版本/ })).toBeVisible();
  // keyboard: Enter opens the second level, 返回 goes back, the entry gets the focus again
  await plusDialog(page).getByRole('button', { name: /^優先級/ }).focus();
  await page.keyboard.press('Enter');
  await expect(plusDialog(page).getByRole('button', { name: '返回' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(plusDialog(page).getByRole('button', { name: /^優先級/ })).toBeFocused();
  await plusDialog(page).getByRole('button', { name: /^優先級/ }).click();
  await plusDialog(page).getByRole('button', { name: 'P2 一般' }).click();
  const pills = () => d.locator('.fbc-pills > *').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  await expect.poll(async () => (await pills()).slice(-2)).toEqual(['優先級：P2 一般（變更優先級）', '加入標籤、優先級或版本']);
  // footer: 內部／公開 then 新增多筆 on the left; 取消 and 建立 on the right
  const vis = d.getByRole('button', { name: '公開範圍：內部' });
  const multi = d.getByRole('switch', { name: '新增多筆' });
  const [vb, mb, cb] = [await vis.boundingBox(), await multi.boundingBox(), await d.getByRole('button', { name: '取消', exact: true }).boundingBox()];
  expect(vb!.x).toBeLessThan(mb!.x); expect(mb!.x).toBeLessThan(cb!.x);
  await vis.click();
  await page.getByRole('menuitemradio', { name: /^公開/ }).click();
  await shot(page, 'create', d);
  await d.getByRole('button', { name: '建立', exact: true }).click();
  await expect(d).toHaveCount(0);
  const list = (await (await page.request.get(`${P}/feedback?limit=10&q=${encodeURIComponent('屬性入口')}`)).json()).data;
  expect(list[0]).toMatchObject({ priority: 'P2', visibility: 'public' });
});

test('ATTR-06 / instant save: the detail saves attributes at once and shows 公開範圍 read-only', async ({ page }) => {
  const { product, make, get } = await setup(page);
  const f = await make('即時儲存');
  await page.goto(`${ADMIN}/products/${product.id}/feedback?item=${f.id}`);
  const d = page.getByRole('dialog', { name: '即時儲存' });
  await expect(d.getByText('公開範圍：內部')).toBeVisible();
  await expect(d.getByRole('button', { name: /^公開範圍/ })).toHaveCount(0);
  await d.getByRole('button', { name: /^優先級：/ }).click();
  await page.getByRole('menuitemradio', { name: 'P3 低' }).click();
  await expect(d.getByText('屬性已儲存')).toBeVisible();
  expect((await get(f.id)).priority).toBe('P3');
  // version from ＋, then changed from its pill (not removed like a tag)
  await d.getByRole('button', { name: /^加入標籤、優先級或版本/ }).click();
  await plusDialog(page).getByRole('button', { name: /^版本/ }).click();
  await expect(plusDialog(page).getByRole('button', { name: '未歸類' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await shot(page, 'detail', d);
});

test('instant save in edit: attributes save at once, the content draft stays; 取消 keeps saved attributes; conflicts never overwrite', async ({ page, browser }) => {
  const { product, P, make, get } = await setup(page);
  const f = await make('草稿');
  await page.goto(`${ADMIN}/products/${product.id}/feedback?item=${f.id}`);
  let form = await openEdit(page, page.getByRole('dialog', { name: '草稿' }));
  await expect(form.getByRole('status').filter({ hasText: '屬性變更會立即儲存' })).toBeVisible();
  await form.getByLabel('標題').fill('草稿（未儲存）');
  // an attribute change while the draft is open: saved now, the draft untouched
  await form.getByRole('button', { name: /^優先級：/ }).click();
  await page.getByRole('menuitemradio', { name: 'P1 重要' }).click();
  await expect(form.getByText('屬性已儲存')).toBeVisible();
  await expect(form.getByLabel('標題')).toHaveValue('草稿（未儲存）');
  expect((await get(f.id))).toMatchObject({ priority: 'P1', title: '草稿' });
  // 公開範圍 in the footer is an attribute too: saved at once
  await form.getByRole('button', { name: '公開範圍：內部' }).click();
  await page.getByRole('menuitemradio', { name: /^公開/ }).click();
  await expect.poll(async () => (await get(f.id)).visibility).toBe('public');
  // 取消 drops only the draft; the saved attributes stay
  await form.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '放棄修改' }).click();
  expect(await get(f.id)).toMatchObject({ title: '草稿', priority: 'P1', visibility: 'public' });

  // someone else changes only an attribute: 儲存 puts the content on the new revision, keeping theirs
  const other = await browser.newContext();
  const op = await other.newPage();
  await login(op, 'admin', 'pm@e2e.test', '產品經理');
  const patch = async (body: Record<string, unknown>) => {
    const cur = (await (await op.request.get(`${P}/feedback/${f.id}`)).json()).data;
    const r = await op.request.patch(`${P}/feedback/${f.id}`, { headers: { origin: ADMIN }, data: { ...body, expectedRevision: cur.revision } });
    expect(r.status(), await r.text()).toBe(200);
  };
  form = await openEdit(page, page.getByRole('dialog', { name: '草稿' }));
  await form.getByLabel('描述').fill('我的描述');
  await patch({ priority: 'P3' });
  await form.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(await get(f.id)).toMatchObject({ description: '我的描述', priority: 'P3' });

  // someone else changes the content: the draft stays, nothing is overwritten unless chosen
  form = await openEdit(page, page.getByRole('dialog', { name: '草稿' }));
  await form.getByLabel('標題').fill('我的標題');
  await patch({ title: '他人的標題' });
  await form.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('剛被其他人修改');
  await expect(form.getByLabel('標題')).toHaveValue('我的標題');
  expect((await get(f.id)).title).toBe('他人的標題');
  await form.getByRole('button', { name: '以我的內容覆蓋' }).click();
  await expect(form).toHaveCount(0);
  expect((await get(f.id)).title).toBe('我的標題');
  await other.close();
});

test('MASK-01..07: board edges fade with mask-image (16px always, wider where columns are hidden); arrows sit outside it', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'roadmaps');
  const main = page.getByRole('main');
  await expect(main.locator('.board-plain > .column')).toHaveCount(5);
  const scroller = main.locator('.board-frame .board-scroll');
  const mask = () => scroller.evaluate((e) => {
    const cs = getComputedStyle(e);
    return { l: cs.getPropertyValue('--mask-l').trim(), r: cs.getPropertyValue('--mask-r').trim(), image: cs.maskImage || cs.getPropertyValue('-webkit-mask-image'), webkit: cs.getPropertyValue('-webkit-mask-image') };
  });
  const wide = page.viewportSize()!.width > 800 ? '64px' : '48px';
  const m0 = await mask();
  expect(m0.image).toContain('linear-gradient');
  expect(m0.webkit).toContain('linear-gradient');
  // no white overlay elements any more
  await expect(main.locator('.board-fade')).toHaveCount(0);
  const overflow = await scroller.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
  if (overflow) {
    expect([m0.l, m0.r]).toEqual(['16px', wide]);
    await scroller.evaluate((e) => { e.scrollLeft = (e.scrollWidth - e.clientWidth) / 2; });
    await expect.poll(async () => { const m = await mask(); return [m.l, m.r]; }).toEqual([wide, wide]);
    await shot(page, 'mask-middle', main.locator('.board-frame'));
    await scroller.evaluate((e) => { e.scrollLeft = e.scrollWidth; });
    await expect.poll(async () => { const m = await mask(); return [m.l, m.r]; }).toEqual([wide, '16px']);
    // the arrows are not inside the masked container
    for (const a of await main.locator('.board-arrow').all()) expect(await a.evaluate((e) => e.closest('.board-scroll'))).toBeNull();
  } else {
    expect([m0.l, m0.r]).toEqual(['16px', '16px']);
  }
  await expectNoPageOverflow(page);
});

test('LIST-01..15: shared filter tables — 新貼文 first, 新增篩選, same Feedback in several tables, in-table order, removal keeps data', async ({ page, browser }) => {
  const { product, P, tagId, make, get, tax } = await setup(page);
  const a = await make('甲：只在新貼文');
  const b = await make('乙：兩個表格都有', { tagIds: [tagId] });
  const c = await make('丙：兩個表格都有', { tagIds: [tagId] });
  await page.goto(`${ADMIN}/products/${product.id}/feedback`);
  const main = page.getByRole('main');
  const tables = main.locator('section.fbv');
  // LIST-02: only 新貼文 at first; handle, name, count, space, (menu), collapse
  await expect(tables).toHaveCount(1);
  const first = tables.first();
  await expect(first.getByRole('heading', { level: 2 })).toHaveText('新貼文');
  await expect(first.getByLabel('共 3 筆')).toBeVisible();
  const head = await first.locator('.fbv-head > *').evaluateAll((els) => els.map((e) => e.className.split(' ')[0]));
  expect(head.filter((c) => !c.startsWith('fbv-spacer'))[0]).toBe('fbv-grip');
  expect(head.slice(1, 3)).toEqual(['fbv-name', 'fbv-count']);
  expect(head.at(-1)).toContain('fbv-icon');
  // LIST-03/11/12: columns, newest first, relative creation time with the full date as a hint
  await expect(first.getByRole('columnheader')).toHaveText(['標題／描述', '分類', '負責人', '留言', /^建立時間/]);
  await expect(first.locator('.fbv-title')).toHaveText(['丙：兩個表格都有', '乙：兩個表格都有', '甲：只在新貼文']);
  await expect(first.locator('.fbv-time').first()).toHaveAttribute('title', /\d{4}/);
  await expect(first.locator('.fbv-desc').first()).toHaveText('丙：兩個表格都有 的描述');
  await shot(page, 'list-one');

  // LIST-05: 新增篩選 → 標籤 → UIUX
  await main.getByRole('button', { name: '新增篩選' }).click();
  await page.getByRole('menuitem', { name: '標籤' }).click();
  await page.getByRole('menuitem', { name: 'UIUX' }).click();
  await expect(tables).toHaveCount(2);
  const second = tables.nth(1);
  await expect(second.getByRole('heading', { level: 2 })).toHaveText('UIUX');
  await expect(second.locator('.fbv-title')).toHaveText(['丙：兩個表格都有', '乙：兩個表格都有']);
  // different, fixed header colours
  const colors = await tables.evaluateAll((els) => els.map((e) => getComputedStyle(e.querySelector('.fbv-head')!).backgroundColor));
  expect(colors[0]).not.toBe(colors[1]);

  // LIST-04/07: a row's priority changed in one table shows in the other; a status change moves it out
  const rowB = (t: Locator) => t.locator('.fbv-item', { hasText: '乙：兩個表格都有' });
  await rowB(first).getByRole('button', { name: /^優先級：/ }).click();
  await page.getByRole('menuitemradio', { name: 'P2 一般' }).click();
  await expect(rowB(second).getByRole('button', { name: /^優先級：P2/ })).toBeVisible();
  expect((await get(b.id)).priority).toBe('P2');
  const other = (await tax()).statuses.find((s: { isDefault: boolean }) => !s.isDefault);
  const cur = await get(b.id);
  await page.request.patch(`${P}/feedback/${b.id}`, { headers: { origin: ADMIN }, data: { statusId: other.id, expectedRevision: cur.revision } });
  await rowB(second).getByRole('button', { name: /^Person tag：/ }).click();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(tables.first().locator('.fbv-title')).toHaveText(['丙：兩個表格都有', '甲：只在新貼文']);
  await expect(tables.nth(1).locator('.fbv-title')).toHaveText(['丙：兩個表格都有', '乙：兩個表格都有']);

  // LIST-14: search applies to every table together with its own condition
  await main.getByRole('searchbox', { name: '搜尋 Feedback' }).fill('丙');
  await expect(tables.first().locator('.fbv-title')).toHaveText(['丙：兩個表格都有']);
  await expect(tables.nth(1).locator('.fbv-title')).toHaveText(['丙：兩個表格都有']);
  await main.getByRole('searchbox', { name: '搜尋 Feedback' }).fill('');
  await expect(tables.first().locator('.fbv-title')).toHaveCount(2);

  // LIST-15: a row opens its detail; its menus do not
  await tables.first().locator('.fbv-item', { hasText: '甲' }).locator('.fbv-desc').click();
  await expect(page.getByRole('dialog', { name: '甲：只在新貼文' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await tables.first().locator('.fbv-item', { hasText: '甲' }).getByRole('button', { name: /^類別：/ }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // LIST-10/11: keyboard move inside a table → manual order; 建立時間 returns to newest first
  await tables.first().locator('.fbv-item', { hasText: '甲' }).locator('.fbv-title').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(tables.first().locator('.fbv-title')).toHaveText(['甲：只在新貼文', '丙：兩個表格都有']);
  await expect(tables.first().locator('.fbv-manual')).toHaveText('手動');
  // the other table is untouched
  await expect(tables.nth(1).locator('.fbv-title')).toHaveText(['丙：兩個表格都有', '乙：兩個表格都有']);
  await page.reload();
  await expect(tables.first().locator('.fbv-title')).toHaveText(['甲：只在新貼文', '丙：兩個表格都有']);
  await tables.first().getByRole('button', { name: /^建立時間/ }).click();
  await expect(tables.first().locator('.fbv-title')).toHaveText(['丙：兩個表格都有', '甲：只在新貼文']);

  // LIST-10: a row dragged onto another table changes nothing there
  if (!test.info().project.use.hasTouch) {
    await tables.first().locator('.fbv-item', { hasText: '甲' }).dragTo(tables.nth(1).locator('.fbv-item').first());
    await page.waitForTimeout(400);
    await expect(tables.nth(1).locator('.fbv-title')).toHaveText(['丙：兩個表格都有', '乙：兩個表格都有']);
    expect((await get(a.id)).tags).toEqual([]);
  }

  // LIST-06/09: table order by keyboard on the handle, shared and kept after a reload, for another member too
  await tables.nth(1).locator('.fbv-grip').focus();
  await page.keyboard.press('ArrowUp');
  await expect(tables.first().getByRole('heading', { level: 2 })).toHaveText('UIUX');
  const otherCtx = await browser.newContext();
  const op = await otherCtx.newPage();
  await login(op, 'admin', 'pm@e2e.test', '產品經理');
  await op.goto(`${ADMIN}/products/${product.id}/feedback`);
  await expect(op.getByRole('main').locator('section.fbv h2')).toHaveText(['UIUX', '新貼文']);
  await otherCtx.close();

  // collapse is separate from the handle and the menu
  await tables.first().getByRole('button', { name: '收合「UIUX」' }).click();
  await expect(tables.first().locator('.fbv-item').first()).toBeHidden();
  await tables.first().getByRole('button', { name: '展開「UIUX」' }).click();

  // LIST-08: removing the table removes the view only
  await tables.first().getByRole('button', { name: '「UIUX」表格操作' }).click();
  await page.getByRole('menuitem', { name: '移除表格' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '移除表格' }).click();
  await expect(tables).toHaveCount(1);
  expect((await get(b.id)).tags.map((t: { id: string }) => t.id)).toContain(tagId);
  expect((await get(c.id)).tags.map((t: { id: string }) => t.id)).toContain(tagId);
  await page.reload();
  await expect(tables).toHaveCount(1);
  await expectNoPageOverflow(page);
  await shot(page, 'list-final');
});

test('LIST-15: narrow screens scroll the table inside itself; no page overflow; table controls reachable', async ({ page }) => {
  const { product, make } = await setup(page);
  await make('一筆很長很長的標題，用來確認窄螢幕下欄位不會重疊也不會撐寬整頁');
  await page.goto(`${ADMIN}/products/${product.id}/feedback`);
  const t = page.getByRole('main').locator('section.fbv').first();
  await expect(t.locator('.fbv-item')).toHaveCount(1);
  await expectNoPageOverflow(page);
  const s = await t.locator('.fbv-scroll').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
  if (page.viewportSize()!.width < 1100) expect(s.sw).toBeGreaterThan(s.cw);
  // the cells never overlap
  const boxes = await t.locator('.fbv-item > [role="cell"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.right]));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i][0]).toBeGreaterThanOrEqual(boxes[i - 1][1] - 1);
  await expect(t.getByRole('button', { name: /^收合「/ })).toBeInViewport();
  await expect(t.getByRole('button', { name: /表格操作$/ })).toBeInViewport();
  await shot(page, 'list-narrow');
});
