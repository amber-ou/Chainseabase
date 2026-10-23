import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

const PORT = Number(process.env.E2E_PORT ?? 3100);
export const ADMIN = `http://127.0.0.1:${PORT}`;
export const PORTAL = `http://localhost:${PORT}`;
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_e2e';
// use the preinstalled Chromium when present (no browser download in CI containers)
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: ADMIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet-768', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } }, testMatch: /responsive\.spec\.ts/ },
    { name: 'mobile-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${ADMIN}/api/v1/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: DB,
      ADMIN_ORIGIN: ADMIN,
      PORTAL_ORIGIN: PORTAL,
      AUTH_SESSION_SECRET: 'e2e-session-secret-not-for-production-0123456789',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      E2E_TEST_LOGIN: 'enabled',
      CALENDAR_PROVIDER: 'fake',
      EMAIL_PROVIDER: 'fake',
      STORAGE_PROVIDER: 'fake',
      JOB_RUNNER_SECRET: 'e2e-job-secret',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
