import { test, expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ADMIN, PORTAL, createProduct, expectNoPageOverflow, login, openFirstProduct, unique } from './helpers';

/**
 * Header, sidebar and board refinements (2026-11-09): admin h1 and subtitles (UI-01..03), Roadmap column
 * add buttons and counts (RM-01..05), desktop sidebar icon collapse (NAV-01..06), Switch geometry
 * (SW-01..03), Roadmap toolbar groups (RM-06..09) and fixed 300px cards with whole-card opening
 * (CARD-01..07). Real rendering and behaviour on the isolated E2E database; screenshots for review only.
 */
const TAG = process.env.SHOT_TAG ?? 'after';
const shot = async (page: Page, name: string, target?: Locator) => {
  await page.waitForTimeout(250);
  const path = test.info().outputPath(`${TAG}-${name}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`);
  if (target) await target.screenshot({ path, animations: 'disabled' });
  else await page.screenshot({ path, fullPage: true, animations: 'disabled' });
};

/** Track and thumb geometry of one Switch, from the rendered boxes. */
const switchGeometry = (sw: Locator) => sw.evaluate((el) => {
  const t = el.getBoundingClientRect();
  const thumb = el.querySelector('[data-slot="switch-thumb"]')!.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const b = parseFloat(cs.borderLeftWidth);
  return {
    left: +(thumb.left - t.left - b).toFixed(2), right: +(t.right - b - thumb.right).toFixed(2),
    top: +(thumb.top - t.top - b).toFixed(2), bottom: +(t.bottom - b - thumb.bottom).toFixed(2),
    thumbW: +thumb.width.toFixed(2), thumbH: +thumb.height.toFixed(2), padding: cs.padding,
  };
});

test('SW-01..03: every Switch keeps its thumb inside the track, centred, with the same inset on both sides', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page, 'roadmaps');
  const checks: { where: string; state: string; g: Awaited<ReturnType<typeof switchGeometry>> }[] = [];
  const sw = page.getByRole('switch', { name: '發佈到前台' });
  await expect(sw).toBeVisible();
  const before = await sw.getAttribute('aria-checked');
  for (const state of ['first', 'second']) {
    await page.waitForTimeout(300); // after the thumb's transition
    checks.push({ where: 'roadmap publish', state: `${state}:${await sw.getAttribute('aria-checked')}`, g: await switchGeometry(sw) });
    if (state === 'first') { await sw.click(); await expect(sw).not.toHaveAttribute('aria-checked', before!); await expect(sw).toBeEnabled(); }
  }
  await sw.click(); // back to how it was
  await expect(sw).toHaveAttribute('aria-checked', before!);
  await shot(page, 'sw-roadmap', page.locator('.publish-toggle'));
  await page.goto(`${base}/feedback`);
  await page.getByRole('main').getByRole('button', { name: '新增 Feedback' }).click();
  const multi = page.getByRole('dialog').getByRole('switch', { name: '新增多筆' });
  for (const state of ['off', 'on']) {
    await page.waitForTimeout(300);
    checks.push({ where: 'create dialog', state, g: await switchGeometry(multi) });
    if (state === 'off') await multi.click();
  }
  await shot(page, 'sw-create', page.locator('.fbc-multi'));
  for (const c of checks) {
    const { g } = c;
    // the thumb stays in the track; the inset is the same on the side it rests on in either state,
    // and it is vertically centred
    expect(Math.min(g.left, g.right, g.top, g.bottom), JSON.stringify(c)).toBeGreaterThanOrEqual(-0.01);
    expect(Math.abs(g.top - g.bottom), JSON.stringify(c)).toBeLessThanOrEqual(0.5);
    expect(g.thumbW, JSON.stringify(c)).toBeCloseTo(g.thumbH, 1);
  }
  const off = checks.filter((c) => /false|off/.test(c.state)).map((c) => c.g.left);
  const on = checks.filter((c) => /true|on$/.test(c.state)).map((c) => c.g.right);
  for (const v of [...off, ...on]) expect(Math.abs(v - off[0]), JSON.stringify(checks)).toBeLessThanOrEqual(0.5);
});

/** A fresh product (isolated data) with cards, a single-choice tag group and boards for each dimension. */
async function setup(page: Page, cards = 3) {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const product = await createProduct(page, unique('精修'));
  const P = `${ADMIN}/api/v1/products/${product.id}`;
  const post = async (path: string, data: unknown, idem = false) => {
    const r = await page.request.post(`${P}${path}`, { headers: { origin: ADMIN, ...(idem ? { 'idempotency-key': randomUUID() } : {}) }, data });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()).data;
  };
  const rev = async () => (await (await page.request.get(`${P}/taxonomy`)).json()).data.productRevision as number;
  for (let i = 1; i <= cards; i++) await post('/feedback', { title: `精修卡片 ${i}`, description: `可選取的描述文字 ${i}` }, true);
  const g = await post('/tag-groups', { name: '發布批次', selectionMode: 'single', expectedRevision: await rev() });
  const groupId = g.group.id as string;
  await post('/tags', { name: '第一批', groupId, expectedRevision: await rev() });
  await post('/tags', { name: '第二批', groupId, expectedRevision: await rev() });
  await post('/roadmaps', { name: '依類別', dimension: 'category' });
  await post('/roadmaps', { name: '依批次', dimension: 'tag_group', tagGroupId: groupId });
  await page.goto(`${ADMIN}/products/${product.id}/roadmaps`);
  const main = page.getByRole('main');
  await expect(main.locator('.board-plain .kcard').first()).toBeVisible();
  return { product, P, main };
}
const columns = (main: Locator) => main.locator('.board-plain > .column');

test('UI-01..03: admin function-page h1 is 14px with no intro subtitle; portal, Login, invite and error pages keep theirs', async ({ page, browser }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page);
  for (const s of ['dashboard', 'calendar', 'feedback', 'roadmaps', 'personal', 'users', 'settings']) {
    await page.goto(`${base}/${s}`);
    const h1 = page.getByRole('main').locator('h1').first();
    await expect(h1).toBeVisible();
    // the heading stays an h1, at the body size (14px), with the page head's spacing pulled in
    await expect.poll(() => h1.evaluate((e) => getComputedStyle(e).fontSize), s).toBe('14px');
    const head = page.locator('.shell .main .page-head').first();
    if (await head.count()) {
      const intro = await head.evaluate((h) => [...h.querySelectorAll('p.sub, p.muted, .page-sub')].map((p) => p.textContent?.trim()));
      // only the kept information stays (Calendar's current product); no introduction paragraphs
      expect(intro.filter((t) => t && !t.startsWith('目前產品')), s).toEqual([]);
    }
  }
  await shot(page, 'admin-h1-settings');
  // pages outside the admin function pages are unchanged: not 14px
  const anon = await browser.newContext();
  const p2 = await anon.newPage();
  for (const url of [`${ADMIN}/login`, `${PORTAL}/login`, `${ADMIN}/invite?token=x`]) {
    await p2.goto(url);
    const h1 = p2.locator('h1').first();
    await expect(h1, url).toBeVisible();
    expect(await h1.evaluate((e) => getComputedStyle(e).fontSize), url).not.toBe('14px');
  }
  await anon.close();
  await page.goto(`${ADMIN}/no-such-page`);
  const err = page.getByRole('heading', { name: '找不到頁面' });
  await expect(err).toBeVisible();
  expect(await err.evaluate((e) => getComputedStyle(e).fontSize)).not.toBe('14px');
  await login(page, 'portal', 'tester@e2e.test', '測試者', '/p/product-1/feedback');
  const ph1 = page.locator('h1').first();
  await expect(ph1).toBeVisible();
  expect(await ph1.evaluate((e) => getComputedStyle(e).fontSize)).not.toBe('14px');
});

test('RM-01..05: no top 新增 Feedback; each column header ends with ＋, after mark, name and count; the dialog presets the column option', async ({ page }) => {
  const { P, main } = await setup(page);
  // RM-01: the old button above the tabs is gone (the Feedback list keeps its own)
  await expect(main.getByRole('button', { name: '新增 Feedback', exact: true })).toHaveCount(0);
  await expect(columns(main)).toHaveCount(5);
  // RM-03: mark → name → count → space → ＋ (the count right after the name, the ＋ at the right end)
  const order = await columns(main).first().locator('.column-head').evaluate((h) => {
    const r = (sel: string) => h.querySelector(sel)!.getBoundingClientRect();
    const mark = r('.mark'), label = r('.label'), count = r('.column-count'), plus = r('button'), head = h.getBoundingClientRect();
    return { mark: mark.left, label: label.left, labelRight: label.right, count: count.left, countRight: count.right, plus: plus.left, plusRight: plus.right, headRight: head.right };
  });
  expect(order.mark).toBeLessThan(order.label);
  expect(order.label).toBeLessThan(order.count);
  expect(order.count - order.labelRight).toBeLessThanOrEqual(12);
  expect(order.plus).toBeGreaterThan(order.countRight + 16);
  expect(order.headRight - order.plusRight).toBeLessThanOrEqual(20);
  await shot(page, 'rm-column-head', columns(main).first().locator('.column-head'));

  const dialog = page.getByRole('dialog', { name: '新增 Feedback' });
  // status board: the second column's status is preset
  const statusName = (await columns(main).nth(1).getAttribute('aria-label'))!.split('，')[0];
  const plus = main.getByRole('button', { name: `新增 Feedback 至〔${statusName}〕` });
  await plus.hover();
  await expect(page.getByRole('tooltip').getByText(`新增 Feedback 至〔${statusName}〕`)).toBeVisible();
  await plus.click();
  await expect(dialog.getByRole('button', { name: `狀態：${statusName}` })).toBeVisible();
  // RM-05: cancel creates nothing
  const before = (await (await page.request.get(`${P}/feedback?limit=100`)).json()).data.length;
  await dialog.getByLabel('標題').fill('不應建立');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '捨棄' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await (await page.request.get(`${P}/feedback?limit=100`)).json()).data.length).toBe(before);
  // created from the column, it lands in that column
  await plus.click();
  await dialog.getByLabel('標題').fill('從欄位新增');
  await dialog.getByRole('button', { name: '建立', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(columns(main).nth(1).locator('.kcard', { hasText: '從欄位新增' })).toBeVisible();

  // category board
  await main.getByRole('tab', { name: '依類別' }).click();
  await expect(main.getByText('當前維度 : 類別')).toBeVisible();
  const catName = (await columns(main).first().getAttribute('aria-label'))!.split('，')[0];
  await main.getByRole('button', { name: `新增 Feedback 至〔${catName}〕` }).click();
  await expect(dialog.getByRole('button', { name: `類別：${catName}` })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  // single-choice tag group board: the group's tag preset; the 未歸類 column presets none of the group
  await main.getByRole('tab', { name: '依批次' }).click();
  await expect(main.getByText(/當前維度 : .*發布批次/)).toBeVisible();
  await main.getByRole('button', { name: '新增 Feedback 至〔第一批〕' }).click();
  await expect(dialog.getByRole('button', { name: /取消選取：.*第一批/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /取消選取：.*第二批/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const unclassified = main.getByRole('button', { name: /新增 Feedback 至〔未歸類/ });
  await unclassified.click();
  await expect(dialog.getByRole('button', { name: /取消選取：.*(第一批|第二批)/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await shot(page, 'rm-tag-board');
});

test('RM-06..09: toolbar groups — dimension | publish switch, label, settings icon … filter icon, search; icons stay icon-only', async ({ page }) => {
  const { main } = await setup(page);
  const tb = main.locator('.rm-toolbar');
  const dim = tb.locator('.rm-dimension'), sw = tb.getByRole('switch', { name: '發佈到前台' });
  const settings = tb.getByRole('button', { name: '看板設定' }), filter = tb.getByRole('button', { name: /^篩選/ }), search = tb.getByRole('searchbox');
  const x = async (l: Locator) => (await l.boundingBox())!;
  const [d, s, g, f, q] = [await x(dim), await x(sw), await x(settings), await x(filter), await x(search)];
  if (page.viewportSize()!.width > 640) {
    expect(d.x).toBeLessThan(s.x); expect(s.x).toBeLessThan(g.x); expect(g.x).toBeLessThan(f.x); expect(f.x).toBeLessThan(q.x);
    await expect(tb.locator('.list-toolbar-start > .toolbar-sep')).toBeVisible();
  }
  // icon-only, same size, with tooltips and names
  for (const b of [settings, filter]) expect((await b.innerText()).trim()).toBe('');
  expect(Math.round(g.height)).toBe(Math.round(f.height));
  expect(Math.round(g.width)).toBe(Math.round(f.width));
  await settings.hover();
  await expect(page.getByRole('tooltip').getByText('看板設定')).toBeVisible();
  // the dimension is text, not a control
  expect(await dim.evaluate((e) => e.closest('button, a, select, [role="combobox"]'))).toBeNull();
  // non-status board: the disabled switch and its text do not look operable
  await main.getByRole('tab', { name: '依類別' }).click();
  await expect(main.getByText('當前維度 : 類別')).toBeVisible();
  await expect(sw).toBeDisabled();
  expect(await tb.locator('.publish-toggle label').evaluate((e) => getComputedStyle(e).cursor)).toBe('default');
  await expect(tb.getByText('（僅狀態看板）')).toBeVisible();
  await expectNoPageOverflow(page);
  const tbBox = (await tb.boundingBox())!;
  for (const l of [dim, sw, settings, filter, search]) {
    const b = await x(l);
    expect(b.x).toBeGreaterThanOrEqual(tbBox.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(tbBox.x + tbBox.width + 1);
  }
  await shot(page, 'rm-toolbar', tb);
});

/** Every rendered card is exactly 300px wide (border-box), and columns are fixed, packed from the left. */
async function expectFixedCards(page: Page, scope: Locator, label: string) {
  const info = await scope.evaluate((root) => {
    const cards = [...root.querySelectorAll<HTMLElement>('.kcard')].map((c) => ({ w: c.getBoundingClientRect().width, box: getComputedStyle(c).boxSizing }));
    const cols = [...root.querySelectorAll<HTMLElement>('.board > .column')].map((c) => c.getBoundingClientRect());
    const scroller = root.querySelector<HTMLElement>('.board-scroll')!.getBoundingClientRect();
    return { cards, widths: cols.map((c) => c.width), firstLeft: cols[0]?.left, scrollLeft: scroller.left, gaps: cols.slice(1).map((c, i) => c.left - cols[i].right) };
  });
  expect(info.cards.length, label).toBeGreaterThan(0);
  for (const c of info.cards) { expect(c.w, label).toBeCloseTo(300, 1); expect(c.box, label).toBe('border-box'); }
  expect(new Set(info.widths.map((w) => Math.round(w))).size, `${label} ${info.widths}`).toBe(1);
  expect(Math.abs(info.firstLeft - info.scrollLeft), label).toBeLessThanOrEqual(1);
  await expectNoPageOverflow(page);
  return info;
}

test('CARD-01..04: cards are exactly 300px on admin Roadmap, Personal and the portal Roadmap; fixed columns from the left; white surface covers all', async ({ page }) => {
  const { main } = await setup(page);
  const r = await expectFixedCards(page, main, 'roadmap status');
  expect(Math.round(r.widths[0])).toBe(333);
  // few columns (category board): they stay 333px and packed left; the white surface still fills the frame
  await main.getByRole('tab', { name: '依類別' }).click();
  await expect(main.getByText('當前維度 : 類別')).toBeVisible();
  const few = await expectFixedCards(page, main, 'roadmap category');
  expect(Math.round(few.widths[0])).toBe(333);
  const cover = await main.locator('.board-frame .board-scroll').evaluate((s) => ({ board: s.querySelector<HTMLElement>('.board')!.getBoundingClientRect().width, frame: s.clientWidth, bg: getComputedStyle(s.querySelector('.board')!).backgroundColor }));
  expect(cover.board).toBeGreaterThanOrEqual(cover.frame - 1);
  await shot(page, 'card-roadmap-few');
  // scroll positions of the full board: left, middle, right keep the column widths
  await main.getByRole('tab', { name: '產品進度' }).click();
  await expect(columns(main)).toHaveCount(5);
  const scroller = main.locator('.board-frame .board-scroll');
  for (const pos of ['left', 'middle', 'right'] as const) {
    await scroller.evaluate((e, p) => { e.scrollLeft = p === 'left' ? 0 : p === 'middle' ? (e.scrollWidth - e.clientWidth) / 2 : e.scrollWidth; }, pos);
    const ws = await columns(main).evaluateAll((cs) => cs.map((c) => Math.round(c.getBoundingClientRect().width)));
    expect(new Set(ws), pos).toEqual(new Set([333]));
    await shot(page, `card-roadmap-${pos}`, main.locator('.board-frame'));
  }
  // Personal
  await page.goto(page.url().replace(/\/roadmaps.*/, '/personal'));
  const pmain = page.getByRole('main');
  await expect(pmain.locator('.board .column').first()).toBeVisible();
  if (await pmain.locator('.kcard').count()) await expectFixedCards(page, pmain, 'personal');
  else expect(Math.round((await pmain.locator('.board > .column').first().boundingBox())!.width)).toBe(318);
  await shot(page, 'card-personal');
  // the portal Roadmap of product-1 (the tester is invited there): one public card on its published board;
  // the board's publish state is put back afterwards
  const p1 = (await (await page.request.get(`${ADMIN}/api/v1/products`)).json()).data.find((p: { slug: string }) => p.slug === 'product-1');
  const P1 = `${ADMIN}/api/v1/products/${p1.id}`;
  const fr = await page.request.post(`${P1}/feedback`, { headers: { origin: ADMIN, 'idempotency-key': randomUUID() }, data: { title: unique('前台卡片'), visibility: 'public' } });
  expect(fr.status(), await fr.text()).toBe(201);
  const rm = (await (await page.request.get(`${P1}/roadmaps`)).json()).data.find((r: { dimension: string }) => r.dimension === 'status');
  const setPublished = async (v: boolean) => {
    const cur = (await (await page.request.get(`${P1}/roadmaps`)).json()).data.find((r: { id: string }) => r.id === rm.id);
    const r = await page.request.patch(`${P1}/roadmaps/${rm.id}`, { headers: { origin: ADMIN }, data: { portalPublished: v, expectedRevision: cur.revision } });
    expect(r.status(), await r.text()).toBe(200);
  };
  if (!rm.portalPublished) await setPublished(true);
  await login(page, 'portal', 'tester@e2e.test', '測試者', '/p/product-1/roadmap');
  await page.goto(`${PORTAL}/p/product-1/roadmap`);
  const portal = page.getByRole('main');
  await expect(portal.locator('.kcard').first()).toBeVisible();
  await expectFixedCards(page, portal, 'portal');
  await shot(page, 'card-portal');
  if (!rm.portalPublished) {
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    await setPublished(false);
  }
});

test('CARD-05..07: the whole card opens the detail; the menu, text selection and drag do not; the title is the keyboard entry', async ({ page }, testInfo) => {
  const { main } = await setup(page);
  const card = main.locator('.kcard', { hasText: '精修卡片 1' });
  const detail = page.getByRole('dialog').filter({ hasText: '精修卡片 1' });
  const close = async () => { await page.keyboard.press('Escape'); await expect(detail).toHaveCount(0); };
  // a blank area of the card (bottom-left corner, inside the padding)
  const b = (await card.boundingBox())!;
  await page.mouse.click(b.x + 6, b.y + b.height - 6);
  await expect(detail).toBeVisible();
  await close();
  // the title
  await card.locator('.kcard-title').click();
  await expect(detail).toBeVisible();
  await close();
  // the ⋯ menu only opens its menu
  await card.getByRole('button', { name: /移動「精修卡片 1」/ }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(detail).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  // keyboard: Tab to the title button and Enter (a real button; no nested button/link inside it)
  await card.locator('.kcard-title').focus();
  await page.keyboard.press('Enter');
  await expect(detail).toBeVisible();
  await close();
  expect(await card.evaluate((c) => c.querySelectorAll('button button, a a, button a, a button').length)).toBe(0);
  expect(await card.evaluate((c) => c.matches('button, a') || c.getAttribute('role') === 'button')).toBe(false);
  // text selection: dragging across the description selects text and opens nothing
  if (!testInfo.project.use.hasTouch) {
    const desc = card.getByText('可選取的描述文字 1');
    if (await desc.count()) {
      const d = (await desc.boundingBox())!;
      await page.mouse.move(d.x + 2, d.y + d.height / 2);
      await page.mouse.down();
      await page.mouse.move(d.x + d.width - 2, d.y + d.height / 2, { steps: 5 });
      await page.mouse.up();
      expect(await page.evaluate(() => String(window.getSelection()).length)).toBeGreaterThan(0);
      await expect(detail).toHaveCount(0);
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
    }
    // drag to another column: moved, and the detail does not open
    const target = columns(main).nth(1); // in view at every width
    await card.dragTo(target.locator('.column-body'));
    await expect(target.locator('.kcard', { hasText: '精修卡片 1' })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(detail).toHaveCount(0);
  }
});

test('NAV-01..06: the desktop sidebar collapses to icons, remembers it, keeps product switching; phones keep the drawer', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && /hydrat/i.test(m.text())) errors.push(m.text()); });
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page, 'roadmaps');
  const shell = page.locator('.shell');
  if (page.viewportSize()!.width <= 1024) {
    // NAV-06: no resident icon rail; the drawer has the full menu even with the desktop preference collapsed
    await page.context().addCookies([{ name: 'csb_sidebar', value: 'collapsed', url: ADMIN }]);
    await page.reload();
    await expect(page.locator('.sidebar')).toBeHidden();
    await page.getByRole('button', { name: '開啟選單' }).click();
    const sheet = page.getByRole('dialog', { name: '選單' });
    await expect(sheet.getByRole('link', { name: 'Feedback' })).toBeVisible();
    await expect(sheet.getByText('Feedback', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /收合側邊欄|展開側邊欄/ })).toBeHidden();
    // the drawer has the full two-line product switcher (2026-11-10 NAV-04)
    await expect(sheet.getByRole('button', { name: /^目前產品 .+ （切換產品）$/ })).toBeVisible();
    await expect(sheet.locator('.product-switcher-name')).toBeVisible();
    await expectNoPageOverflow(page);
    await shot(page, 'nav-mobile-drawer');
    return;
  }
  const sidebar = page.locator('#admin-sidebar');
  const main = page.locator('main#main');
  await expect(page.getByRole('main').locator('.board-plain')).toBeVisible();
  const wide = (await main.boundingBox())!.width;
  await shot(page, 'nav-expanded');
  // 2026-11-10 NAV-01: the toggle sits at the left of the page title, not in the sidebar
  const toggle = main.getByRole('button', { name: '收合側邊欄' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(shell).toHaveAttribute('data-sidebar', 'collapsed');
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(64);
  await expect.poll(async () => (await main.boundingBox())!.width).toBeGreaterThan(wide + 150);
  // NAV-03: text hidden, names kept; the current page still marked; tooltips; the account opens Setting
  const fb = sidebar.getByRole('link', { name: 'Feedback' });
  await expect(fb).toBeVisible();
  expect(await sidebar.getByText('lead@e2e.test').evaluate((e) => e.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  await expect(sidebar.getByRole('link', { name: 'Roadmap' })).toHaveAttribute('aria-current', 'page');
  await fb.hover();
  await expect(page.getByRole('tooltip').getByText('Feedback')).toBeVisible();
  await fb.focus();
  await expect(fb).toBeFocused();
  await expect(sidebar.getByRole('link', { name: /開啟 Setting/ })).toBeVisible();
  // NAV-02: reload keeps it, with no hydration error and the narrow width from the first paint
  await page.reload();
  await expect(shell).toHaveAttribute('data-sidebar', 'collapsed');
  expect(Math.round((await sidebar.boundingBox())!.width)).toBe(64);
  await page.goto(`${base}/feedback`);
  await expect(shell).toHaveAttribute('data-sidebar', 'collapsed');
  await shot(page, 'nav-collapsed');
  // NAV-04: the icon product switcher still switches products
  const other = await createProduct(page, unique('收合切換'));
  await page.reload();
  const sw = sidebar.getByRole('button', { name: /^目前產品 .+ （切換產品）$/ });
  await sw.click();
  await page.getByRole('menuitemradio', { name: other.name }).click();
  await page.waitForURL(new RegExp(`/products/${other.id}/feedback`));
  await expect(sidebar.getByRole('button', { name: `目前產品 ${other.name} （切換產品）` })).toBeVisible();
  // NAV-06: the notification panel stays in the viewport when opened from the narrow rail
  await sidebar.getByRole('button', { name: /Notification/ }).click();
  const panel = page.getByRole('dialog', { name: '通知' });
  await expect(panel).toBeVisible();
  const pb = (await panel.boundingBox())!, vp = page.viewportSize()!;
  expect(pb.x).toBeGreaterThanOrEqual(0); expect(pb.y).toBeGreaterThanOrEqual(0);
  expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width); expect(pb.y + pb.height).toBeLessThanOrEqual(vp.height);
  await shot(page, 'nav-collapsed-notification');
  await page.keyboard.press('Escape');
  // product list page (no product selected): the icon entry still offers the products
  await page.goto(`${ADMIN}/products`);
  await page.waitForURL(/\/products/);
  // expand again, remembered as expanded
  await page.getByRole('main').getByRole('button', { name: '展開側邊欄' }).click();
  await expect(shell).toHaveAttribute('data-sidebar', 'expanded');
  await page.reload();
  await expect(shell).toHaveAttribute('data-sidebar', 'expanded');
  await expect(sidebar.getByText('Chainseabase')).toBeVisible();
  expect(errors).toEqual([]);
  void testInfo;
});
