/**
 * `npm run config:check`: load the configuration with the same rules as the website and the
 * CLI scripts, then run the application's own validation. Prints variable names, their source
 * and provider modes only; never values. Exit codes: 0 valid, 78 refused by the loader,
 * 1 refused by the application configuration.
 */
import { applyConfigOrExit, describeSources } from './config/load-config.mjs';

const resolved = applyConfigOrExit();
console.log(`APP_ENV: ${resolved.appEnv}`);
console.log(`Configuration file: ${resolved.configFile ?? (resolved.fileSource === '.env.local' ? '.env.local (development)' : 'none (process environment only)')}`);
for (const row of describeSources(resolved)) console.log(`  ${row.name.padEnd(32)} ${row.source === '-' ? 'not set' : row.source}`);

import('../src/server/config')
  .then(({ getConfig }) => {
    const cfg = getConfig();
    console.log(`Application configuration valid: environment=${cfg.deploymentEnv}, calendar=${cfg.calendarProvider}, email=${cfg.emailProvider}, storage=${cfg.storageProvider}`);
    if (cfg.calendarProvider === 'fake' || cfg.emailProvider === 'fake' || cfg.storageProvider === 'fake') {
      console.log('Note: fake providers are development stand-ins, not real integrations.');
    }
  })
  .catch((e) => {
    // getConfig reports variable names only
    console.error(`Application configuration refused: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
