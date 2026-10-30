import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { PORTAL, login, openFirstProduct } from './helpers';

/**
 * V02/V03 (automated part): axe-core WCAG 2.1 A/AA rules on the core admin and portal screens,
 * including an open modal. This does not replace the manual keyboard pass or a real screen
 * reader test, which are tracked separately as not yet executed.
 */
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

async function axe(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () => {
    const r = await (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n: any) => n.target.join(' ')) }));
  });
  expect(result, `${label}: ${JSON.stringify(result, null, 2)}`).toEqual([]);
}

for (const section of ['dashboard', 'feedback', 'roadmaps', 'personal', 'users', 'settings']) {
  test(`axe: admin ${section}`, async ({ page }) => {
    await login(page, 'admin', 'lead@e2e.test', '專案負責人');
    await openFirstProduct(page, section);
    await axe(page, `admin ${section}`);
  });
}

test('axe: admin feedback modal with schedule tab', async ({ page }) => {
  await login(page, 'admin', 'lead@e2e.test', '專案負責人');
  await openFirstProduct(page, 'feedback');
  await page.getByRole('button', { name: '新增 Feedback' }).click();
  await axe(page, 'feedback modal');
  await page.getByRole('dialog', { name: '新增 Feedback' }).getByRole('tab', { name: /Schedule/ }).click();
  await axe(page, 'schedule tab');
});

test('axe: login and portal pages', async ({ page }) => {
  await page.goto(`${PORTAL}/login`);
  await axe(page, 'portal login');
  // the login prompt shown to anonymous visitors (WIN-04)
  await page.goto(`${PORTAL}/p/product-1/feedback`);
  await page.getByText('請先登入').waitFor();
  await axe(page, 'portal login prompt');
  await login(page, 'portal', 'tester@e2e.test', '測試者', '/p/product-1/feedback');
  for (const path of ['/p/product-1/feedback', '/p/product-1/roadmap']) {
    await page.goto(`${PORTAL}${path}`);
    await axe(page, `portal ${path}`);
  }
});
