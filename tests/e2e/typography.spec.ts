import { test, expect, type Page } from '@playwright/test';
import { ADMIN, PORTAL, login, openFirstProduct } from './helpers';

/**
 * Fonts and weights as rendered (site-wide UI/UX pass): Latin letters and digits in Inter, Chinese
 * in Noto Sans TC, and no weight outside the loaded 400 / 500 / 600 (anything else is synthesised).
 * The fonts that drew each node come from Chromium's DevTools protocol, not from the CSS.
 */
async function renderedFonts(page: Page, selector: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  expect(nodeId, selector).toBeTruthy();
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  await cdp.detach();
  return fonts.map((f) => ({ family: f.familyName, custom: f.isCustomFont, glyphs: f.glyphCount }));
}

async function weightsInUse(page: Page) {
  return page.evaluate(() => {
    const seen = new Map<string, string>();
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (!el.offsetParent && el.tagName !== 'BODY') continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
      const w = getComputedStyle(el).fontWeight;
      if (!seen.has(w)) seen.set(w, `${el.tagName.toLowerCase()} "${el.textContent!.trim().slice(0, 20)}"`);
    }
    return Object.fromEntries(seen);
  });
}

test('Inter for Latin, Noto Sans TC for Chinese, only loaded weights; section titles are not bolded', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  const base = await openFirstProduct(page, 'calendar');
  await page.evaluate(() => document.fonts.ready);
  // the font stack on body and in a shadcn control
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toMatch(/Inter.*Noto Sans TC/);

  // 「產品日曆」: a section title, Chinese glyphs from Noto Sans TC at 500
  const section = page.getByRole('heading', { name: '產品日曆' });
  await expect(section).toHaveCSS('font-weight', '500');
  await expect(section).toHaveCSS('font-size', '16px');
  await section.evaluate((el) => el.setAttribute('data-font-probe', 'section'));
  const sectionFonts = await renderedFonts(page, '[data-font-probe="section"]');
  // one web font file: Noto Sans TC's own 500 (Medium) face, so the weight is real, not synthesised
  expect(sectionFonts).toHaveLength(1);
  expect(sectionFonts[0].family).toMatch(/^Noto Sans TC\b.*Medium$/);
  expect(sectionFonts[0].custom).toBe(true);

  // the page title mixes Latin only: Inter at 600
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveCSS('font-weight', '600');
  await h1.evaluate((el) => el.setAttribute('data-font-probe', 'h1'));
  expect((await renderedFonts(page, '[data-font-probe="h1"]')).map((f) => f.family)).toEqual(['Inter']);

  // mixed text: 「目前產品：產品1」 draws Chinese with Noto Sans TC and the digit with Inter
  const mixed = page.getByText(/^目前產品：/);
  await mixed.evaluate((el) => el.setAttribute('data-font-probe', 'mixed'));
  const mixedFonts = await renderedFonts(page, '[data-font-probe="mixed"]');
  expect(mixedFonts.map((f) => f.family.replace(/^(Inter|Noto Sans TC)\b.*$/, '$1')).sort()).toEqual(['Inter', 'Noto Sans TC']);
  expect(mixedFonts.every((f) => f.custom)).toBe(true); // web fonts, not a system fallback

  // every visible text on the main pages uses a loaded weight
  for (const section of ['dashboard', 'calendar', 'feedback', 'roadmaps', 'users', 'personal', 'settings']) {
    await page.goto(`${base}/${section}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const used = await weightsInUse(page);
    expect(Object.keys(used).filter((w) => !['400', '500', '600'].includes(w)), `${section}: ${JSON.stringify(used)}`).toEqual([]);
  }
  // the login page and the portal too
  await page.goto(`${PORTAL}/login`);
  await page.evaluate(() => document.fonts.ready);
  expect(Object.keys(await weightsInUse(page)).filter((w) => !['400', '500', '600'].includes(w))).toEqual([]);
  await page.goto(`${ADMIN}/products`);
});
