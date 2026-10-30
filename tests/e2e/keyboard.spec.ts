import { expect, test, type Page } from '@playwright/test';
import { ADMIN, PORTAL, focused, login, openFirstProduct, tabTo, unique } from './helpers';

/**
 * V02 keyboard walkthrough (automated part): keyboard-only operation of the core flows in
 * Chromium, with focus checked after every step. A screen-reader pass is not covered here.
 */

/**
 * Tab through the whole page: every stop shows a focus indicator. Focus inside a native
 * date/time picker belongs to the browser (the host does not match :focus) and is skipped.
 */
async function sweep(page: Page, max = 80) {
  const stops: string[] = [];
  let firstId: string | null = null;
  let prevId: string | null = null;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body || !e.matches(':focus')) return null;
      const w = window as unknown as { kbSeq?: number };
      e.dataset.kbStop ??= String((w.kbSeq = (w.kbSeq ?? 0) + 1));
      const cs = getComputedStyle(e);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
      const label = (e as HTMLInputElement).labels?.[0]?.textContent;
      return { id: e.dataset.kbStop, ring, name: `${e.tagName.toLowerCase()} ${(e.getAttribute('aria-label') ?? label ?? e.innerText ?? '').trim().slice(0, 30)}` };
    });
    if (!s) continue;
    // a date input is several consecutive stops on one element; the cycle is a return to the first
    if (s.id === firstId && prevId !== firstId) break;
    firstId ??= s.id;
    prevId = s.id;
    expect(s.ring, `focus indicator on "${s.name}"`).toBe(true);
    stops.push(s.name);
  }
  expect(stops.length).toBeGreaterThan(3);
  return stops;
}

test.describe('desktop keyboard walkthrough', () => {
  test('skip link moves focus into main; every admin screen has a visible focus indicator', async ({ page }) => {
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    const base = await openFirstProduct(page);
    for (const section of ['dashboard', 'feedback', 'roadmaps', 'personal', 'users', 'settings']) {
      await page.goto(`${base}/${section}`);
      await page.waitForLoadState('networkidle');
      await page.keyboard.press('Tab');
      await expect.poll(() => focused(page)).toMatch(/跳到主要內容/);
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('main');
      await sweep(page);
    }
  });

  test('popovers return focus to their trigger; Escape then closes the modal back to its opener', async ({ page }) => {
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    await openFirstProduct(page, 'feedback');
    await tabTo(page, /新增 Feedback/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '新增 Feedback' })).toBeVisible();
    await tabTo(page, /^button Person tag/);
    await page.keyboard.press('Enter');
    await expect.poll(() => focused(page)).toMatch(/搜尋Person tag/);
    await page.keyboard.press('Escape');
    await expect.poll(() => focused(page)).toMatch(/^button Person tag/);
    await expect(page.getByRole('dialog', { name: '新增 Feedback' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => focused(page)).toMatch(/新增 Feedback/);
  });

  test('schedule by keyboard: tab arrows, cell selection fills the command, Ctrl+Enter applies to the draft', async ({ page }) => {
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    await openFirstProduct(page, 'feedback');
    await tabTo(page, /新增 Feedback/);
    await page.keyboard.press('Enter');
    await page.keyboard.type(unique('鍵盤 Schedule'));
    await tabTo(page, /^button\[tab\] 內容/);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focused(page)).toMatch(/^button\[tab\] Schedule/);
    await tabTo(page, /第 2 列，UIUX/);
    await page.keyboard.press('Enter');
    await expect.poll(() => focused(page)).toMatch(/^textarea Schedule 留言或指令/);
    await page.keyboard.type('鍵盤輸入');
    await expect(page.getByLabel('Schedule 留言或指令')).toHaveValue('/2-2 鍵盤輸入');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByText('已套用至草稿：寫入 1 筆').first()).toBeVisible();
    // leaving with a draft asks first; the safe choice has focus
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '捨棄未建立的 Feedback？' })).toBeVisible();
    await expect.poll(() => focused(page)).toMatch(/取消/);
    await page.keyboard.press('Escape');
    await expect.poll(() => focused(page)).toMatch(/^textarea Schedule 留言或指令/);
  });

  test('roadmap card menu: Escape returns to the trigger, a move keeps focus on the moved card', async ({ page }) => {
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    const base = await openFirstProduct(page, 'feedback');
    const title = unique('鍵盤移動');
    await page.getByRole('button', { name: '新增 Feedback' }).click();
    await page.getByLabel('標題').fill(title);
    await page.getByRole('button', { name: '建立', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto(`${base}/roadmaps`);
    await page.waitForLoadState('networkidle');
    await tabTo(page, new RegExp(`移動「${title}」`));
    await page.keyboard.press('Enter');
    await expect.poll(() => focused(page)).toMatch(/^button\[menuitem\] 進行中/);
    await page.keyboard.press('Escape');
    await expect.poll(() => focused(page)).toMatch(new RegExp(`移動「${title}」`));
    await page.keyboard.press('Enter');
    await expect.poll(() => focused(page)).toMatch(/^button\[menuitem\] 進行中/);
    await page.keyboard.press('Enter'); // first item: 進行中
    await expect(page.getByText(`已將「${title}」移到「進行中」`)).toBeAttached();
    await expect.poll(() => focused(page)).toMatch(new RegExp(`移動「${title}」`));
    const column = await page.evaluate(() => document.activeElement?.closest('[role="listitem"]')?.getAttribute('aria-label'));
    expect(column).toMatch(/^進行中/);
  });

  test('a menu item that opens a dialog keeps focus in the dialog, and closing returns to the menu', async ({ page }) => {
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    await openFirstProduct(page, 'users');
    await tabTo(page, /^button 管理 /);
    await page.keyboard.press('Enter');
    await expect.poll(() => focused(page)).toMatch(/^button\[menuitem\]/);
    // menu items are reached with arrows (Tab closes the menu)
    for (let i = 0; i < 3 && !/變更角色/.test(await focused(page)); i++) await page.keyboard.press('ArrowDown');
    await expect.poll(() => focused(page)).toMatch(/^button\[menuitem\] 變更角色/);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // after the menu's own deferred focus handling, focus is still inside the dialog
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => focused(page)).toMatch(/^button 管理 /);
  });

  test('notification panel takes focus and Escape returns it to the button', async ({ page }) => {
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    await openFirstProduct(page);
    await tabTo(page, /^button Notification/);
    await page.keyboard.press('Enter');
    await expect.poll(() => focused(page)).toMatch(/^div\[dialog\] 通知/);
    await page.keyboard.press('Escape');
    await expect.poll(() => focused(page)).toMatch(/^button Notification/);
  });

  test('calendar (fake provider): connect and bind by keyboard, focus follows each step; view tabs use arrows', async ({ page }) => {
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    const headers = { origin: ADMIN };
    // a fresh product, an extra writable fake calendar (one calendar binds to one product only)
    // and a disconnected personal connection, so every setup step is shown
    const created = await page.request.post(`${ADMIN}/api/v1/products`, { headers, data: { name: unique('鍵盤產品') } });
    expect(created.status()).toBe(201);
    const productId = (await created.json()).data.id;
    const extra = await page.request.post(`${ADMIN}/api/v1/test-support/calendar/connect`, { headers, data: { calendarId: `kb-${Date.now()}@fake.local` } });
    expect(extra.status()).toBe(200);
    expect((await page.request.delete(`${ADMIN}/api/v1/integrations/google/calendar/connection`, { headers })).status()).toBe(200);
    await page.goto(`${ADMIN}/products/${productId}/dashboard`);
    await page.waitForLoadState('networkidle');
    await tabTo(page, /連結模擬日曆/);
    await page.keyboard.press('Enter');
    await expect.poll(() => focused(page)).toMatch(/^select/);
    await page.keyboard.press('End'); // the calendar added last, not bound to any product
    await tabTo(page, /^button 綁定$/, 5);
    await page.keyboard.press('Enter');
    await expect.poll(() => focused(page)).toMatch(/^button\[tab\] 月/);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focused(page)).toMatch(/^button\[tab\] 週/);
    await expect(page.getByRole('tab', { name: '週' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect.poll(() => focused(page)).toMatch(/^button\[tab\] 活動清單/);
    await page.keyboard.press('Home');
    await expect.poll(() => focused(page)).toMatch(/^button\[tab\] 月/);
    // 新增活動 stays disabled (not focusable) until the calendar data with the access role has loaded;
    // tabbing earlier skips it into the month grid
    await expect(page.getByRole('button', { name: '新增活動' })).toBeEnabled();
    await tabTo(page, /新增活動/, 15);
    await page.keyboard.press('Enter');
    const summary = unique('鍵盤會議');
    await page.keyboard.type(summary);
    await sweep(page, 40); // every stop in the event dialog, date pickers included, shows focus
    await page.getByRole('dialog', { name: '新增活動' }).getByRole('button', { name: '儲存' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => focused(page)).toMatch(/新增活動/);
  });

  test('portal: invited tester creates feedback and votes with Space without losing focus', async ({ page }) => {
    await login(page, 'portal', 'tester@e2e.test', '測試者', '/p/product-1/feedback');
    await page.goto(`${PORTAL}/p/product-1/feedback`);
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('main');
    await tabTo(page, /^button 新增回饋/);
    await page.keyboard.press('Enter');
    await expect.poll(() => focused(page)).toMatch(/^input 標題/);
    await page.keyboard.type(unique('鍵盤回饋'));
    await tabTo(page, /^button 送出/, 10);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '新增回饋' })).toHaveCount(0);
    await page.goto(`${PORTAL}/p/product-1/feedback`);
    await page.waitForLoadState('networkidle');
    await tabTo(page, /^button 投票，目前/);
    await page.keyboard.press('Space');
    await expect.poll(() => focused(page)).toMatch(/^button 收回投票，目前/);
    await page.keyboard.press('Space');
    await expect.poll(() => focused(page)).toMatch(/^button 投票，目前/);
  });
});
