import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
export default defineConfig({
  testDir: 'tests/ui', testMatch: '*.spec.ts', workers: 1,
  outputDir: 'test-results/ui',
  use: { baseURL: 'http://127.0.0.1:3201', launchOptions: { executablePath }, screenshot: 'only-on-failure' },
  projects: [1440, 768, 390].map((width) => ({ name: `ui-${width}`, use: { viewport: { width, height: 900 } } })),
  webServer: { command: 'npx vite --config tests/ui/vite.config.ts', url: 'http://127.0.0.1:3201', reuseExistingServer: false },
});
