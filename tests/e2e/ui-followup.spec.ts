import { test, expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ADMIN, PORTAL, createProduct, expectNoPageOverflow, login, openFirstProduct, unique } from './helpers';

/**
 * Follow-up UI/UX batch (2026-11-10): sidebar toggle and product switcher (NAV-01..04), toolbars
 * (TOOL-01..04), Calendar subtitle (CAL-01), board edge fades (BOARD-01..03), typing focus (FB-01/02),
 * and the created Feedback's detail, edit and comments (DETAIL, COMMENT, SCROLL). Real rendering and
 * behaviour on the isolated E2E database; screenshots are written for review only.
 */
const TAG = process.env.SHOT_TAG ?? 'after';
const shot = async (page: Page, name: string, target?: Locator) => {
  await page.waitForTimeout(250);
  const path = test.info().outputPath(`${TAG}-${name}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`);
  if (target) await target.screenshot({ path, animations: 'disabled' });
  else await page.screenshot({ path, fullPage: false, animations: 'disabled' });
};
const pngOf = (color: string, w = 400, h = 260) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

/** A fresh product (isolated data) with one Feedback that has images and comments. */
async function setup(page: Page, opts: { comments?: number; description?: string; feedbackImages?: number } = {}) {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const product = await createProduct(page, unique('詳情'));
  const P = `${ADMIN}/api/v1/products/${product.id}`;
  const upload = async (kind: 'feedback-images' | 'comment-images', color = '#7aa2e3') => {
    const r = await page.request.post(`${P}/${kind}`, { headers: { origin: ADMIN, 'content-type': 'image/png' }, data: await pngOf(color) });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()).data.id as string;
  };
  const imageIds: string[] = [];
  for (let i = 0; i < (opts.feedbackImages ?? 2); i++) imageIds.push(await upload('feedback-images', i ? '#e3a27a' : '#7aa2e3'));
  const fr = await page.request.post(`${P}/feedback`, { headers: { origin: ADMIN, 'idempotency-key': randomUUID() }, data: { title: '詳情測試', description: opts.description ?? '希望在詳情集中查看討論。', imageIds } });
  expect(fr.status(), await fr.text()).toBe(201);
  const feedback = (await fr.json()).data;
  for (let i = 0; i < (opts.comments ?? 3); i++) {
    const r = await page.request.post(`${P}/feedback/${feedback.id}/comments`, { headers: { origin: ADMIN }, data: { body: `第 ${i + 1} 則留言` } });
    expect(r.status()).toBe(201);
  }
  return { product, P, feedback, imageIds, upload };
}
const openDetail = async (page: Page, productId: string, feedbackId: string) => {
  await page.goto(`${ADMIN}/products/${productId}/feedback?item=${feedbackId}`);
  const d = page.getByRole('dialog', { name: '詳情測試' });
  await expect(d).toBeVisible();
  return d;
};

test('FB-01/02: clicking and typing (with an input method) shows no ring; Tab shows a quiet one', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  await page.getByRole('main').getByRole('button', { name: '新增 Feedback' }).click();
  const title = page.getByRole('dialog', { name: '新增 Feedback' }).getByLabel('標題');
  const ring = (l: Locator) => l.evaluate((e) => ({ style: getComputedStyle(e).outlineStyle, width: getComputedStyle(e).outlineWidth, color: getComputedStyle(e).outlineColor, mode: document.documentElement.dataset.input }));
  await title.click();
  await page.keyboard.type('abc');
  // an input method composes: Process keys, arrows to pick, Escape to cancel a candidate
  await title.evaluate((e) => {
    for (const key of ['Process', 'ArrowDown', 'ArrowUp']) e.dispatchEvent(new KeyboardEvent('keydown', { key, isComposing: true, keyCode: 229, bubbles: true }));
  });
  // the same composition keys seen by the page-level listener (Escape included), without closing the dialog
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, keyCode: 229 })));
  expect(await ring(title)).toMatchObject({ style: 'none', mode: 'pointer' });
  await expect(title).toBeFocused();
  // keyboard: Tab to the description, the ring is there, in the 3:1 grey (not the heavy dark ring)
  await page.keyboard.press('Tab');
  const desc = page.getByLabel('描述');
  await expect(desc).toBeFocused();
  expect(await ring(desc)).toMatchObject({ style: 'solid', width: '2px', color: 'rgb(135, 146, 164)', mode: 'keyboard' });
});

test('DETAIL-01/02/05/06: read-only detail with images and attributes, ⋯ menu and close; no author, no create footer', async ({ page }) => {
  const { product, feedback } = await setup(page);
  const d = await openDetail(page, product.id, feedback.id);
  await expect(d.getByRole('heading', { name: '詳情測試' })).toBeVisible();
  await expect(d.getByText('希望在詳情集中查看討論。')).toBeVisible();
  await expect(d.getByRole('list', { name: '圖片，共 2 張' }).getByRole('img')).toHaveCount(2);
  // not the create form: no 新增 Feedback heading, 新增多筆, 取消／建立; read-only text, no textarea for it
  await expect(d.getByText('新增多筆')).toHaveCount(0);
  await expect(d.getByRole('button', { name: '建立' })).toHaveCount(0);
  await expect(d.getByLabel('標題')).toHaveCount(0);
  // DETAIL-05: the Feedback's author and creation time are not shown (comment authors are)
  await expect(d.locator('.fd-top').getByText('專案負責人')).toHaveCount(0);
  await expect(d.locator('.fd-top time')).toHaveCount(0);
  // DETAIL-06: status, category, Person tag, chosen tags, then ＋ last
  const order = await d.locator('.fd-top .fbc-pills > *').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  expect(order[0]).toMatch(/^狀態：/); expect(order[1]).toMatch(/^類別：/); expect(order[2]).toMatch(/^Person tag：/);
  expect(order.at(-1)).toMatch(/^加入標籤/);
  // a pill change is saved at once to the same Feedback
  await d.getByRole('button', { name: /^狀態：/ }).click();
  const target = page.getByRole('menuitemradio').nth(1);
  const statusName = (await target.textContent())!.trim();
  await target.click();
  await expect(d.getByRole('button', { name: `狀態：${statusName}` })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`${ADMIN}/api/v1/products/${product.id}/feedback/${feedback.id}`)).json()).data.status.name).toBe(statusName);
  // ⋯ holds 編輯 and 刪除; close is always there
  await d.getByRole('button', { name: 'Feedback 更多操作' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['編輯', '刪除']);
  await page.keyboard.press('Escape');
  await shot(page, 'detail');
  await d.getByRole('button', { name: '關閉' }).click();
  await expect(d).toHaveCount(0);
});

test('DETAIL-03/04: 編輯 uses the shared form, 儲存 updates the same Feedback (text, images, settings); 取消 returns unchanged', async ({ page }, testInfo) => {
  const { product, P, feedback, imageIds } = await setup(page);
  const count = async () => (await (await page.request.get(`${P}/feedback?limit=100`)).json()).meta.total as number;
  const before = await count();
  let d = await openDetail(page, product.id, feedback.id);
  await d.getByRole('button', { name: 'Feedback 更多操作' }).click();
  await page.getByRole('menuitem', { name: '編輯' }).click();
  let form = page.getByRole('dialog', { name: '編輯 Feedback' });
  await expect(form.getByLabel('標題')).toHaveValue('詳情測試');
  await expect(form.getByLabel('描述')).toHaveValue('希望在詳情集中查看討論。');
  await expect(form.getByRole('list', { name: /已選圖片，共 2 張/ })).toBeVisible();
  // DETAIL-04 (as rearranged by ATTR-01..04): priority as a pill, version from ＋, 內部／公開 in the footer
  await expect(form.getByRole('button', { name: /^優先級：/ })).toBeVisible();
  await form.getByRole('button', { name: /^加入標籤、優先級或版本/ }).click();
  await expect(page.getByRole('dialog', { name: '加入標籤、優先級或版本' }).getByRole('button', { name: /^版本/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(form.getByRole('button', { name: '公開範圍：內部' })).toBeVisible();
  await expect(form.getByText('新增多筆')).toHaveCount(0);
  // 取消 (with a change) asks, then returns to the detail with nothing saved
  await form.getByLabel('標題').fill('不要存');
  await form.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '放棄修改' }).click();
  d = page.getByRole('dialog', { name: '詳情測試' });
  await expect(d).toBeVisible();
  // edit for real: title, remove the first image, add a new one; 公開 is an attribute, saved at once
  await d.getByRole('button', { name: 'Feedback 更多操作' }).click();
  await page.getByRole('menuitem', { name: '編輯' }).click();
  form = page.getByRole('dialog', { name: '編輯 Feedback' });
  await form.getByLabel('標題').fill('詳情測試（已編輯）');
  await form.getByRole('button', { name: '移除圖片 1' }).click();
  await form.locator('input[type="file"]').setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: await pngOf('#6abf69') });
  await expect(form.locator('.fbc-preview[data-state="done"]')).toHaveCount(2);
  await form.getByRole('button', { name: '公開範圍：內部' }).click();
  await page.getByRole('menuitemradio', { name: /^公開/ }).click();
  await expect(form.getByRole('button', { name: '公開範圍：公開' })).toBeVisible();
  await shot(page, 'edit');
  await form.getByRole('button', { name: '儲存', exact: true }).click();
  d = page.getByRole('dialog', { name: '詳情測試（已編輯）' });
  await expect(d).toBeVisible();
  // the same Feedback, no copy; images: the kept one, then the new one
  expect(await count()).toBe(before);
  const now = (await (await page.request.get(`${P}/feedback/${feedback.id}`)).json()).data;
  expect([now.id, now.title, now.visibility]).toEqual([feedback.id, '詳情測試（已編輯）', 'public']);
  const imgs = (await (await page.request.get(`${P}/feedback/${feedback.id}/images`)).json()).data.map((i: { id: string }) => i.id);
  expect(imgs).toHaveLength(2);
  expect(imgs[0]).toBe(imageIds[1]);
  expect(imgs).not.toContain(imageIds[0]);
  await expect(d.getByRole('list', { name: '圖片，共 2 張' })).toBeVisible();
  void testInfo;
});

test('DETAIL-02: 刪除 asks first; cancel keeps it, confirm removes it', async ({ page }) => {
  const { product, P, feedback } = await setup(page, { comments: 2 });
  const d = await openDetail(page, product.id, feedback.id);
  await d.getByRole('button', { name: 'Feedback 更多操作' }).click();
  await page.getByRole('menuitem', { name: '刪除' }).click();
  const confirm = page.getByRole('alertdialog', { name: '刪除這筆 Feedback？' });
  await expect(confirm).toContainText('2 則留言');
  await confirm.getByRole('button', { name: '取消' }).click();
  expect((await page.request.get(`${P}/feedback/${feedback.id}`)).status()).toBe(200);
  await d.getByRole('button', { name: 'Feedback 更多操作' }).click();
  await page.getByRole('menuitem', { name: '刪除' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '刪除', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await page.request.get(`${P}/feedback/${feedback.id}`)).status()).toBe(404);
});

test('COMMENT-01..06: heading with the real count; bubble with the time beside it; like; images upload, show and follow access', async ({ page, browser }, testInfo) => {
  const { product, P, feedback } = await setup(page, { comments: 2 });
  const d = await openDetail(page, product.id, feedback.id);
  await expect(d.getByRole('heading', { name: '留言' })).toBeVisible();
  await expect(d.getByLabel('共 2 則留言')).toBeVisible();
  const first = d.getByRole('article', { name: '專案負責人 的留言' }).first();
  // COMMENT-02: the time is right of the bubble, vertically centred on it, and not inside it
  const g = await first.evaluate((a) => {
    const b = a.querySelector('.fd-bubble')!.getBoundingClientRect(), t = a.querySelector('time')!.getBoundingClientRect();
    return { gap: t.left - b.right, dy: Math.abs((t.top + t.bottom) / 2 - (b.top + b.bottom) / 2), inside: Boolean(a.querySelector('.fd-bubble time')) };
  });
  if (page.viewportSize()!.width > 640) { expect(g.gap).toBeGreaterThanOrEqual(0); expect(g.gap).toBeLessThanOrEqual(12); }
  expect(g.dy).toBeLessThanOrEqual(2);
  expect(g.inside).toBe(false);
  // COMMENT-03: one like style: no fill, outline icon; liked = solid icon in the accent colour
  const like = first.getByRole('button', { name: /^按讚，目前 0 個讚/ });
  const look = (l: Locator) => l.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, fill: e.querySelector('svg')!.getAttribute('fill'), color: getComputedStyle(e).color }));
  expect(await look(like)).toMatchObject({ bg: 'rgba(0, 0, 0, 0)', fill: 'none' });
  await like.click();
  const liked = first.getByRole('button', { name: /^收回讚，目前 1 個讚/ });
  await expect(liked).toHaveAttribute('aria-pressed', 'true');
  expect(await look(liked)).toMatchObject({ bg: 'rgba(0, 0, 0, 0)', fill: 'currentColor', color: 'rgb(11, 46, 131)' });
  // COMMENT-04/05: send stays unavailable while empty; an image is picked, uploaded and shown
  const send = d.getByRole('button', { name: '送出留言' });
  await expect(send).toHaveAttribute('aria-disabled', 'true');
  await d.getByLabel('新增留言').fill('附圖留言');
  await d.locator('.fd-composer input[type="file"]').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: await pngOf('#aa66cc') }, { name: 'bad.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') }]);
  await expect(d.getByText('「bad.gif」不是 JPEG、PNG 或 WebP。')).toBeVisible();
  await expect(d.locator('.fd-composer .fbc-preview[data-state="done"]')).toHaveCount(1);
  await expect(send).not.toHaveAttribute('aria-disabled', 'true');
  await send.click();
  const mine = d.getByRole('article').filter({ hasText: '附圖留言' });
  await expect(mine.getByRole('img', { name: '留言圖片 1' })).toBeVisible();
  await expect(d.getByLabel('共 3 則留言')).toBeVisible();
  await expect(d.getByLabel('新增留言')).toHaveValue('');
  await shot(page, 'comments');
  // COMMENT-06: the image is served by the admin API; a tester or someone signed out gets nothing
  const src = (await mine.getByRole('img', { name: '留言圖片 1' }).getAttribute('src'))!;
  expect(src).toMatch(/^\/api\/v1\/products\/.+\/comments\/.+\/images\/.+\/thumb$/);
  const r = await page.request.get(`${ADMIN}${src}`);
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toBe('private, no-store, max-age=0');
  const anon = await browser.newContext();
  expect((await anon.request.get(`${ADMIN}${src}`)).status()).toBe(401);
  await anon.close();
  // the comment list from the API carries the image too
  const list = (await (await page.request.get(`${P}/feedback/${feedback.id}/comments`)).json()).data;
  expect(list.find((c: { body: string }) => c.body === '附圖留言').images).toHaveLength(1);
  void testInfo;
});

test('SCROLL-01..05: detail above, comments scroll on their own with fades and arrows, composer fixed at the bottom', async ({ page }) => {
  const long = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 段很長的描述內容，用來確認上方區域會在內部捲動。`).join('\n\n');
  const { product, feedback } = await setup(page, { comments: 14, description: long });
  const d = await openDetail(page, product.id, feedback.id);
  const top = d.locator('.fd-top'), list = d.locator('.fd-comment-list'), composer = d.locator('.fd-composer');
  await expect(d.getByRole('article').first()).toBeVisible();
  // measured after the opening zoom has finished
  await expect(d).toHaveAttribute('data-state', 'open');
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  // the whole dialog is inside the window; close and ⋯ reachable; the page itself does not scroll sideways
  const box = (await d.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  await expect(d.getByRole('button', { name: '關閉' })).toBeInViewport();
  await expect(d.getByRole('button', { name: 'Feedback 更多操作' })).toBeInViewport();
  await expectNoPageOverflow(page);
  // SCROLL-02: a very long description scrolls inside the top part, which leaves room for comments
  const t = await top.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
  expect(t.sh).toBeGreaterThan(t.ch);
  expect((await list.boundingBox())!.height).toBeGreaterThanOrEqual(60);
  // SCROLL-03/04: at the top only the lower fade and the down arrow; the arrow scrolls; the top part stays put
  const fades = () => d.locator('.fd-fade').evaluateAll((els) => els.map((e) => e.hasAttribute('data-on')));
  await expect.poll(fades).toEqual([false, true]);
  await expect(d.getByRole('button', { name: '向上捲動留言' })).toHaveCount(0);
  const topY = (await top.boundingBox())!.y;
  await d.getByRole('button', { name: '向下捲動留言' }).click();
  await expect.poll(() => list.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await expect.poll(fades).toEqual([true, true]);
  await expect(d.getByRole('button', { name: '向上捲動留言' })).toBeVisible();
  expect((await top.boundingBox())!.y).toBeCloseTo(topY, 0);
  // the fades never catch input
  expect(await d.locator('.fd-fade').first().evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
  // at the bottom: the lower fade and arrow go
  await list.evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await expect.poll(fades).toEqual([true, false]);
  await expect(d.getByRole('button', { name: '向下捲動留言' })).toHaveCount(0);
  // SCROLL-05: the composer stays at the bottom of the dialog, input and send visible
  const [now, c] = [(await d.boundingBox())!, (await composer.boundingBox())!];
  expect(Math.abs(now.y + now.height - (c.y + c.height))).toBeLessThanOrEqual(2);
  await expect(d.getByLabel('新增留言')).toBeInViewport();
  await expect(d.getByRole('button', { name: '送出留言' })).toBeInViewport();
  await shot(page, 'scroll');
  // a short window keeps all three parts
  await page.setViewportSize({ width: vp.width, height: 520 });
  await expect(d.getByRole('button', { name: '送出留言' })).toBeInViewport();
  expect((await list.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await shot(page, 'scroll-short');
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(d.getByRole('button', { name: '送出留言' })).toBeInViewport();
  await expectNoPageOverflow(page);
  await shot(page, 'scroll-320');
});

test('COMMENT-07: the portal detail uses the same layout with portal permissions (no remove, no image upload)', async ({ page }) => {
  // a public Feedback of product-1 with a team comment that has an image (made through the admin API)
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const p1 = (await (await page.request.get(`${ADMIN}/api/v1/products`)).json()).data.find((p: { slug: string }) => p.slug === 'product-1');
  const P1 = `${ADMIN}/api/v1/products/${p1.id}`;
  const title = unique('前台詳情');
  const fr = await page.request.post(`${P1}/feedback`, { headers: { origin: ADMIN, 'idempotency-key': randomUUID() }, data: { title, visibility: 'public' } });
  const f = (await fr.json()).data;
  const img = (await (await page.request.post(`${P1}/comment-images`, { headers: { origin: ADMIN, 'content-type': 'image/png' }, data: await pngOf('#3399aa') })).json()).data.id;
  expect((await page.request.post(`${P1}/feedback/${f.id}/comments`, { headers: { origin: ADMIN }, data: { body: '團隊附圖', imageIds: [img] } })).status()).toBe(201);
  await login(page, 'portal', 'tester@e2e.test', '測試者', `/p/product-1/feedback?item=${f.id}`);
  await page.goto(`${PORTAL}/p/product-1/feedback?item=${f.id}`);
  const d = page.getByRole('dialog', { name: title });
  await expect(d).toBeVisible();
  const team = d.getByRole('article').filter({ hasText: '團隊附圖' });
  await expect(team.getByRole('img', { name: '留言圖片 1' })).toBeVisible();
  expect(await team.getByRole('img', { name: '留言圖片 1' }).getAttribute('src')).toContain('/api/v1/public/products/product-1/comments/');
  // no remove on the portal, no image picker; like and reply stay
  await expect(team.getByRole('button', { name: /更多操作/ })).toHaveCount(0);
  await expect(d.getByRole('button', { name: /^加入圖片/ })).toHaveCount(0);
  await expect(team.getByRole('button', { name: /^按讚/ })).toBeVisible();
  await d.getByLabel('新增留言').fill('測試者的留言');
  await d.getByRole('button', { name: '送出留言' }).click();
  const mine = d.getByRole('article').filter({ hasText: '測試者的留言' });
  await expect(mine).toBeVisible();
  // the tester may edit their own comment (⋯ → 編輯 only)
  await mine.getByRole('button', { name: /更多操作/ }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['編輯']);
  await page.keyboard.press('Escape');
  await expectNoPageOverflow(page);
  await shot(page, 'portal-detail');
});

test('NAV-01..04: toggle left of the page title; two-line product switcher with a matching menu; collapsed keeps a readable menu', async ({ page }) => {
  test.skip(page.viewportSize()!.width <= 1024, 'desktop sidebar (phones keep the drawer, covered in ui-refine)');
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page, 'calendar');
  const main = page.getByRole('main');
  const toggle = main.getByRole('button', { name: '收合側邊欄' });
  const h1 = main.locator('h1');
  const [tb, hb] = [(await toggle.boundingBox())!, (await h1.boundingBox())!];
  expect(tb.x + tb.width).toBeLessThanOrEqual(hb.x);
  expect(Math.abs((tb.y + tb.height / 2) - (hb.y + hb.height / 2))).toBeLessThanOrEqual(3);
  await expect(page.locator('#admin-sidebar').getByRole('button', { name: /側邊欄/ })).toHaveCount(0);
  // CAL-01: no 「目前產品：…」 line under the Calendar title; the section title stays
  await expect(main.getByText(/^目前產品：/)).toHaveCount(0);
  await expect(main.getByRole('heading', { name: '產品日曆' })).toBeVisible();
  // NAV-02/03: icon, two lines, chevron; the menu as wide as the trigger, a check on the current product
  const sidebar = page.locator('#admin-sidebar');
  const trigger = sidebar.getByRole('button', { name: /^目前產品 .+ （切換產品）$/ });
  await expect(trigger.locator('.product-switcher-kicker')).toHaveText('目前產品');
  const current = (await trigger.locator('.product-switcher-name').textContent())!;
  expect(current.length).toBeGreaterThan(0);
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  // the rendered width (after the opening zoom) equals the trigger's
  const menuWidth = async () => menu.evaluate((e) => parseFloat(getComputedStyle(e).width));
  expect(Math.abs((await menuWidth()) - (await trigger.boundingBox())!.width)).toBeLessThanOrEqual(1);
  await expect(menu.getByRole('menuitemradio', { name: current, exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio', { name: current, exact: true }).locator('svg')).toBeVisible();
  await expect(menu.locator('[role="menuitemradio"][aria-checked="false"] svg')).toHaveCount(0);
  await shot(page, 'switcher');
  await page.keyboard.press('Escape');
  // NAV-01/04: collapse from the same button (now 展開); the switcher is only its icon; the menu stays readable
  await toggle.click();
  await expect(page.locator('.shell')).toHaveAttribute('data-sidebar', 'collapsed');
  const expand = main.getByRole('button', { name: '展開側邊欄' });
  // the same place relative to the title (polled: the main area slides while the sidebar narrows)
  await expect.poll(async () => Math.abs((await expand.boundingBox())!.x - (await main.locator('h1').boundingBox())!.x + (hb.x - tb.x))).toBeLessThanOrEqual(2);
  await trigger.hover();
  await expect(page.getByRole('tooltip').getByText(`目前產品：${current}（切換產品）`)).toBeVisible();
  await trigger.click();
  expect(await page.getByRole('menu').evaluate((e) => parseFloat(getComputedStyle(e).width))).toBeGreaterThanOrEqual(200);
  await shot(page, 'switcher-collapsed');
  await page.keyboard.press('Escape');
  await expand.click();
  await expect(page.locator('.shell')).toHaveAttribute('data-sidebar', 'expanded');
  void base;
});

test('TOOL-01..04: icon buttons without resting fill or border; thin rules between groups; transparent search', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page, 'feedback');
  const look = (l: Locator) => l.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, border: getComputedStyle(e).borderTopWidth, text: (e as HTMLElement).innerText.trim() }));
  for (const [path, buttons] of [['feedback', ['篩選']], ['roadmaps', ['篩選', '看板設定']]] as const) {
    await page.goto(`${base}/${path}`);
    const main = page.getByRole('main');
    for (const name of buttons) {
      const b = main.getByRole('button', { name: new RegExp(`^${name}`) });
      await expect(b).toBeVisible();
      expect(await look(b), name).toEqual({ bg: 'rgba(0, 0, 0, 0)', border: '0px', text: '' });
      const size = (await b.boundingBox())!;
      expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(page.viewportSize()!.width <= 640 ? 44 : 36);
      await b.hover();
      await expect(page.getByRole('tooltip').getByText(name, { exact: true })).toBeVisible();
      await page.mouse.move(0, 0);
    }
    const search = main.locator('[data-slot="input-group"]');
    expect(await search.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    // a rule between the filter and the search (wide screens)
    const sep = main.locator('.list-toolbar-end > .toolbar-sep');
    await expect(sep).toHaveCount(1);
    const [f, s, q] = [await main.getByRole('button', { name: /^篩選/ }).boundingBox(), await sep.boundingBox(), await search.boundingBox()];
    expect(f!.x).toBeLessThan(s!.x); expect(s!.x).toBeLessThan(q!.x);
    await expectNoPageOverflow(page);
    await shot(page, `toolbar-${path}`, main.locator('.list-toolbar'));
  }
});

test('BOARD-01..03 (as MASK-01..07 since 2026-11-10): the edges follow the hidden columns on Roadmap and Personal, re-measured when the sidebar collapses', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page, 'roadmaps');
  const main = page.getByRole('main');
  await expect(main.locator('.board-plain > .column')).toHaveCount(5);
  const wide = page.viewportSize()!.width > 800 ? '64px' : '48px';
  const edges = (s: Locator) => s.evaluate((e) => [getComputedStyle(e).getPropertyValue('--mask-l').trim(), getComputedStyle(e).getPropertyValue('--mask-r').trim()]);
  const overflowOf = (s: Locator) => s.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
  const scroller = main.locator('.board-frame .board-scroll');
  await expect.poll(() => edges(scroller)).toEqual(['16px', (await overflowOf(scroller)) ? wide : '16px']);
  // no white overlay and nothing catching input: the mask is on the scroller itself
  await expect(main.locator('.board-fade')).toHaveCount(0);
  // collapsing the sidebar (more room) re-checks the edges
  if (page.viewportSize()!.width > 1024) {
    await main.getByRole('button', { name: '收合側邊欄' }).click();
    await expect.poll(async () => (await edges(scroller))[1]).toBe((await overflowOf(scroller)) ? wide : '16px');
    await shot(page, 'board-mask-collapsed', main.locator('.board-frame'));
    await main.getByRole('button', { name: '展開側邊欄' }).click();
  }
  // Personal uses the same board and mask
  await page.goto(`${base}/personal`);
  await expect(main.locator('.board .column').first()).toBeVisible();
  const p = main.locator('.board-scroll');
  await expect.poll(() => edges(p)).toEqual(['16px', (await overflowOf(p)) ? wide : '16px']);
  await expectNoPageOverflow(page);
});
