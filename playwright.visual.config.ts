import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * Visual comparison (UI stabilisation, 2026-11-09): the same server and isolated E2E database as the E2E
 * run, a separate folder and project so `npm run test:e2e` and CI do not run it.
 *
 * Baselines are NOT committed until the user approves the screens. Until then a run only writes candidate
 * images (and reports "missing" baselines). After approval:
 *   npm run test:visual -- --update-snapshots      (writes tests/visual/__screenshots__, then commit)
 *   npm run test:visual                            (compares against the approved baselines)
 */
export default defineConfig({
  ...base,
  testDir: 'tests/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  // a missing baseline is never written by a plain run: only --update-snapshots, after approval
  updateSnapshots: 'none',
  expect: { ...base.expect, toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.002 } },
  projects: [
    { name: 'visual-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'visual-768', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'visual-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});
