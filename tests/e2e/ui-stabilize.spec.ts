import { test, expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ADMIN, createProduct, expectNoPageOverflow, login, openFirstProduct, unique } from './helpers';

/**
 * UI stabilisation (2026-11-09): the Roadmap board's real rendering, not only CSS values.
 * - RM-FIX01: a plain hover draws no dashed frame; a real drag over a valid column shows a soft fill.
 * - RM-FIX02: the white board and its column rules cover every column at the left, middle and right
 *   scroll positions (checked on the rendered pixels), for different column counts.
 * - RM-FIX03: the board fills the height left under the page header, tabs and toolbar (no large grey
 *   area under it), grows with its content, and still works when the toolbar wraps or the window is short.
 * - RM-FIX04: 「當前維度 : …」 from the board's real dimension, read-only, left of the publish switch.
 * Screenshots are written for review with a tag (SHOT_TAG, e.g. before / after); they are not baselines.
 */
const TAG = process.env.SHOT_TAG ?? 'after';
const shot = async (page: Page, name: string, target?: Locator) => {
  await page.waitForTimeout(250);
  const path = test.info().outputPath(`${TAG}-${name}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`);
  if (target) await target.screenshot({ path, animations: 'disabled' });
  else await page.screenshot({ path, fullPage: true, animations: 'disabled' });
};

async function setup(page: Page, cards = 3) {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page);
  const product = await createProduct(page, unique('穩定化'));
  const P = `${ADMIN}/api/v1/products/${product.id}`;
  const post = async (path: string, data: unknown, idem = false) => {
    const r = await page.request.post(`${P}${path}`, { headers: { origin: ADMIN, ...(idem ? { 'idempotency-key': randomUUID() } : {}) }, data });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()).data;
  };
  const rev = async () => (await (await page.request.get(`${P}/taxonomy`)).json()).data.productRevision as number;
  for (let i = 1; i <= cards; i++) await post('/feedback', { title: `穩定化卡片 ${i}` }, true);
  // a single-choice tag group with two tags, and boards for each dimension
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

/**
 * Pixels of one horizontal line inside the board, below the cards: only white and the column rule.
 * `inset` leaves out the edges, which fade into the page on purpose (MASK-01..07, 2026-11-10: at most
 * 64px on a side); everything between them must be the white board.
 */
async function lineColours(page: Page, scroller: Locator, yFromTop: number, inset = 0) {
  const png = await scroller.screenshot({ animations: 'disabled' });
  const img = sharp(png);
  const { width, height } = await img.metadata();
  const y = Math.min(height! - 2, yFromTop);
  const { data, info } = await img.extract({ left: inset, top: y, width: width! - 2 * inset, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  const colours = new Map<string, number>();
  for (let x = 0; x < info.width; x++) {
    const i = x * info.channels;
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    colours.set(key, (colours.get(key) ?? 0) + 1);
  }
  return colours;
}
const WHITE = '255,255,255';
const GROUND = '245,247,250'; // --ground, the grey page background

test('RM-FIX01: hovering an empty column shows no dashed frame; only a real drag shows a soft fill', async ({ page }) => {
  const { main } = await setup(page);
  const empty = main.locator('.board-plain .column').nth(1);
  await empty.locator('.column-body').hover();
  await shot(page, 'rm01-hover', main.locator('.board-frame'));
  const dashed = () => main.locator('.board-plain').evaluate((b) => [b, ...b.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el);
    const side = ['Top', 'Right', 'Bottom', 'Left'].some((s) => cs.getPropertyValue(`border-${s.toLowerCase()}-style`) === 'dashed'
      && parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0 && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(cs.getPropertyValue(`border-${s.toLowerCase()}-color`)));
    return side || (cs.outlineStyle === 'dashed' && parseFloat(cs.outlineWidth) > 0);
  }).length);
  expect(await dashed()).toBe(0);
  // a real drag (HTML5 events, as the browser sends them) over another column
  const card = main.locator('.board-plain .kcard').first();
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent('dragstart', { dataTransfer: dt });
  await empty.dispatchEvent('dragover', { dataTransfer: dt });
  await expect(empty).toHaveAttribute('data-drop', 'true');
  // the fill fades in (150ms): wait for it
  await expect.poll(() => empty.evaluate((c) => getComputedStyle(c).backgroundColor)).toBe('rgb(232, 238, 248)'); // --active
  expect(await dashed()).toBe(0);
  await shot(page, 'rm01-drag', main.locator('.board-frame'));
  await card.dispatchEvent('dragend', { dataTransfer: dt });
  await expect(empty).not.toHaveAttribute('data-drop', 'true');
});

test('RM-FIX02: the white board and rules cover every column at the left, middle and right', async ({ page }) => {
  const { main } = await setup(page);
  const scroller = main.locator('.board-frame .board-scroll');
  const found: { tab: string; where: string; geo: Record<string, number>; ground: boolean; white: number; colours: string }[] = [];
  for (const tab of ['產品進度', '依類別', '依批次']) {
    await main.getByRole('tab', { name: tab, exact: true }).click();
    await expect(main.locator('.board-plain .column').first()).toBeVisible();
    await page.waitForTimeout(200);
    // the board element itself must span the whole scrollable content (every column inside it)
    const geo = await scroller.evaluate((s) => {
      const board = s.querySelector<HTMLElement>('.board-plain')!;
      const cols = [...board.querySelectorAll<HTMLElement>(':scope > .column')];
      const b = board.getBoundingClientRect();
      return { scrollWidth: s.scrollWidth, clientWidth: s.clientWidth, boardWidth: Math.round(b.width), columnsRight: Math.round(Math.max(...cols.map((c) => c.getBoundingClientRect().right)) - b.left), count: cols.length };
    });
    const positions = geo.scrollWidth > geo.clientWidth ? [0, (geo.scrollWidth - geo.clientWidth) / 2, geo.scrollWidth] : [0];
    for (const [i, left] of positions.entries()) {
      const where = ['left', 'middle', 'right'][i];
      await scroller.evaluate((s, x) => { s.scrollLeft = x; }, left);
      await page.waitForTimeout(100);
      await shot(page, `rm02-${tab}-${where}`, main.locator('.board-frame'));
      // a line near the bottom of the board, under the cards: white and rules only, never the grey page
      const h = (await scroller.boundingBox())!.height;
      const colours = await lineColours(page, scroller, Math.round(h - 12), 64);
      const total = [...colours.values()].reduce((a, b) => a + b, 0);
      found.push({ tab, where, geo, ground: colours.has(GROUND), white: (colours.get(WHITE) ?? 0) / total, colours: JSON.stringify([...colours]) });
    }
  }
  for (const f of found) {
    expect(f.geo.boardWidth, `${f.tab}: board ${f.geo.boardWidth} < content ${f.geo.scrollWidth}`).toBeGreaterThanOrEqual(f.geo.scrollWidth - 1);
    expect(f.geo.columnsRight, f.tab).toBeLessThanOrEqual(f.geo.boardWidth + 1);
    expect(f.ground, `${f.tab} @${f.where}: ${f.colours}`).toBe(false);
    expect(f.white, `${f.tab} @${f.where}`).toBeGreaterThan(0.95);
  }
  await expectNoPageOverflow(page);
});

test('RM-FIX03: the board fills the height under the toolbar and grows with its content', async ({ page }) => {
  const { main, P } = await setup(page);
  const frame = main.locator('.board-frame');
  const measure = () => page.evaluate(() => {
    const board = document.querySelector('.board-plain')!.getBoundingClientRect();
    const mainEl = document.querySelector('main')!;
    const padBottom = parseFloat(getComputedStyle(mainEl).paddingBottom);
    return { boardBottom: board.bottom + window.scrollY, docHeight: document.documentElement.scrollHeight, viewport: window.innerHeight, padBottom };
  });
  await shot(page, 'rm03-height');
  const m = await measure();
  // few cards: the page does not scroll, and under the board there is only the page's bottom padding
  expect(m.docHeight).toBeLessThanOrEqual(m.viewport + 1);
  expect(m.viewport - m.boardBottom).toBeLessThanOrEqual(m.padBottom + 1);
  expect(m.padBottom).toBeLessThanOrEqual(24);
  // many cards: the board grows, the page scrolls, no card is cut off
  for (let i = 0; i < 14; i++) {
    const r = await page.request.post(`${P}/feedback`, { headers: { origin: ADMIN, 'idempotency-key': randomUUID() }, data: { title: `延伸卡片 ${i}` } });
    expect(r.status()).toBe(201);
  }
  await page.reload();
  await expect(main.locator('.board-plain .kcard')).toHaveCount(17);
  const tall = await page.evaluate(() => {
    const board = document.querySelector('.board-plain')!.getBoundingClientRect();
    const last = [...document.querySelectorAll('.board-plain .kcard')].map((c) => c.getBoundingClientRect().bottom);
    return { boardBottom: board.bottom, lastCard: Math.max(...last), docHeight: document.documentElement.scrollHeight, viewport: window.innerHeight };
  });
  expect(tall.docHeight).toBeGreaterThan(tall.viewport);
  expect(tall.lastCard).toBeLessThanOrEqual(tall.boardBottom);
  await shot(page, 'rm03-tall');
  await expect(frame).toBeVisible();
});

test('RM-FIX03: a short window and a wrapped toolbar keep a usable board without page overflow', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-390');
  await page.setViewportSize({ width: 390, height: 560 });
  const { main } = await setup(page);
  await expectNoPageOverflow(page);
  const board = await main.locator('.board-plain').boundingBox();
  expect(board!.height).toBeGreaterThanOrEqual(120);
  for (const name of ['看板設定', '篩選']) await expect(main.getByRole('button', { name, exact: true })).toBeVisible();
  await shot(page, 'rm03-short');
});

test('RM-FIX04: 當前維度 shows the board\'s real dimension, read-only, left of the publish switch', async ({ page }) => {
  const { main } = await setup(page);
  const label = main.locator('.rm-dimension');
  const expected: [string, string][] = [['產品進度', '當前維度 : 狀態'], ['依類別', '當前維度 : 類別'], ['依批次', '當前維度 : 單選 Tag 群組（發布批次）']];
  for (const [tab, text] of expected) {
    await main.getByRole('tab', { name: tab, exact: true }).click();
    await expect(label).toHaveText(text);
    // plain text: not a control, not focusable
    expect(await label.evaluate((el) => [el.tagName, el.getAttribute('role'), el.getAttribute('tabindex'), el.querySelector('button, select, input, [tabindex]')])).toEqual(['SPAN', null, null, null]);
    // left of the switch on the same line, or on the line above when a narrow toolbar wraps
    const [l, w] = [(await label.boundingBox())!, (await main.getByRole('switch', { name: '發佈到前台' }).boundingBox())!];
    const sameLine = Math.abs((l.y + l.height / 2) - (w.y + w.height / 2)) < 8;
    expect(sameLine ? l.x + l.width <= w.x : l.y + l.height <= w.y + 1, JSON.stringify({ l, w })).toBe(true);
    if (page.viewportSize()!.width >= 768) expect(sameLine).toBe(true);
  }
  // tabs keep only the board names
  await expect(main.getByRole('tab')).toHaveText(['產品進度', '依類別', '依批次']);
  await expect(main.getByRole('combobox', { name: /維度/ })).toHaveCount(0);
  await expectNoPageOverflow(page);
  await shot(page, 'rm04-toolbar', main.locator('.list-toolbar').first());
});
