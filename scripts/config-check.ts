/**
 * `npm run config:check`: load the configuration with the same rules as the website and the
 * CLI scripts, then run the application's own validation. Prints variable names, their source
 * and provider modes only; never values. Exit codes: 0 valid, 78 refused by the loader,
 * 1 refused by the application configuration.
 */
import { randomBytes } from 'node:crypto';
import { rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyConfigOrExit, describeSources } from './config/load-config.mjs';

const resolved = applyConfigOrExit();
console.log(`APP_ENV: ${resolved.appEnv}`);
console.log(`Configuration file: ${resolved.configFile ?? (resolved.fileSource === '.env.local' ? '.env.local (development)' : 'none (process environment only)')}`);
for (const row of describeSources(resolved)) console.log(`  ${row.name.padEnd(32)} ${row.source === '-' ? 'not set' : row.source}`);

import('../src/server/config')
  .then(async ({ getConfig }) => {
    const cfg = getConfig();
    console.log(`Application configuration valid: environment=${cfg.deploymentEnv}, calendar=${cfg.calendarProvider}, email=${cfg.emailProvider}, storage=${cfg.storageProvider} (${cfg.storageBackend})`);
    if (cfg.calendarProvider === 'fake' || cfg.emailProvider === 'fake' || cfg.storageProvider === 'fake') {
      console.log('Note: fake providers are development stand-ins, not real integrations.');
    }
    if (cfg.storageBackend === 'filesystem' && cfg.avatarStorageDir) {
      // the root is never created here: it is made and protected by the installer (WIN-02)
      const root = cfg.avatarStorageDir;
      if (!(await stat(root).catch(() => null))?.isDirectory()) {
        console.error(`Avatar storage directory missing: ${root} (run Initialize-ChainseabaseAvatarStorage.ps1)`);
        process.exitCode = 1;
        return;
      }
      const probe = path.join(root, `.config-check-${randomBytes(6).toString('hex')}.tmp`);
      try {
        await writeFile(probe, '', { flag: 'wx' });
        console.log(`Avatar storage directory: ${root} (writable by the current account)`);
      } catch (e) {
        console.error(`Avatar storage directory not writable by the current account: ${root} (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
        process.exitCode = 1;
      } finally {
        await rm(probe, { force: true });
      }
    }
  })
  .catch((e) => {
    // getConfig reports variable names only
    console.error(`Application configuration refused: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
