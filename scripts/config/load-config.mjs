/**
 * One configuration loading rule for the website, CLI scripts and scheduled tasks (WIN-01).
 * Plain ESM with no dependencies so it can run as a Node preload (`node --import`) before
 * Next.js or any script reads process.env, on Windows and Linux alike.
 *
 * Sources, in this order:
 *   1. CHAINSEABASE_CONFIG_FILE: an absolute path to a KEY=VALUE file kept outside the
 *      repository and protected by NTFS ACL / file mode. The only allowed source for
 *      APP_ENV=staging|production (services and scheduled tasks never rely on an
 *      interactive shell's environment).
 *   2. Development without a config file: `.env.local` in the app directory, the same file
 *      `next dev` reads, so CLI scripts and the website see the same values.
 *   3. The process environment: a key may also be set there only with the same value as the
 *      file (and, in development, for keys the files do not set).
 *
 * Conflicting sources are refused instead of picking one silently. Problems name variables,
 * files and line numbers only; values are never printed.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Every variable the application reads. Unknown keys in a config file are refused (typos). */
export const APP_KEYS = Object.freeze([
  'APP_ENV',
  'DATABASE_URL', 'DIRECT_DATABASE_URL', 'PGPASSWORD',
  'ADMIN_ORIGIN', 'PORTAL_ORIGIN',
  'AUTH_SESSION_SECRET',
  'TOKEN_ENCRYPTION_KEY', 'TOKEN_ENCRYPTION_KEY_VERSION', 'TOKEN_ENCRYPTION_PREVIOUS_KEYS',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'BOOTSTRAP_TEAM_EMAIL',
  'RESEND_API_KEY', 'RESEND_FROM_EMAIL',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_AVATAR_BUCKET',
  'CRON_SECRET', 'JOB_RUNNER_SECRET',
  'CALENDAR_PROVIDER', 'EMAIL_PROVIDER', 'STORAGE_PROVIDER',
  'E2E_TEST_LOGIN', 'LOG_REQUESTS',
]);

/** Environment files Next.js loads on its own; with a config file they would be a hidden second source. */
export const NEXT_ENV_FILES = Object.freeze(['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local']);

const KEY = /^[A-Z][A-Z0-9_]*$/;

/**
 * Parse KEY=VALUE text. Blank lines and lines starting with # are ignored; a value may be
 * wrapped in matching single or double quotes (no escapes, no interpolation, no inline
 * comments, since secrets may contain #). Handles a UTF-8 BOM and CRLF line endings, which
 * Windows editors and PowerShell 5.1 produce.
 */
export function parseConfigText(text, label = 'config file') {
  const values = {};
  const problems = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq).trim() : '';
    if (!KEY.test(key)) { problems.push(`${label} line ${i + 1} is not KEY=VALUE`); return; }
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) value = value.slice(1, -1);
    if (Object.hasOwn(values, key)) { problems.push(`${label} sets ${key} more than once`); return; }
    values[key] = value;
  });
  return { values, problems };
}

const isStrict = (appEnv) => appEnv === 'staging' || appEnv === 'production';
const present = (v) => v !== undefined && String(v).trim() !== '';

function urlPassword(raw) {
  try { return decodeURIComponent(new URL(raw).password); } catch { return ''; }
}

/**
 * Work out the effective configuration without touching process.env.
 * @param {{ env?: Record<string, string | undefined>, cwd?: string, platform?: string, fsImpl?: typeof fs }} [opts]
 */
export function resolveConfig({ env = process.env, cwd = process.cwd(), platform = process.platform, fsImpl = fs } = {}) {
  const problems = [];
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {Record<string, 'config file' | '.env.local' | 'process'>} */
  const sources = {};
  const configFile = present(env.CHAINSEABASE_CONFIG_FILE) ? env.CHAINSEABASE_CONFIG_FILE.trim() : null;
  let fileValues = {};
  let fileSource = null;

  if (configFile) {
    const isAbs = platform === 'win32' ? path.win32.isAbsolute(configFile) : path.posix.isAbsolute(configFile);
    if (!isAbs) problems.push('CHAINSEABASE_CONFIG_FILE must be an absolute path');
    else if (!fsImpl.existsSync(configFile)) problems.push('CHAINSEABASE_CONFIG_FILE does not exist');
    else {
      const parsed = parseConfigText(fsImpl.readFileSync(configFile, 'utf8'), 'config file');
      problems.push(...parsed.problems);
      fileValues = parsed.values;
      fileSource = 'config file';
      for (const key of Object.keys(fileValues)) if (!APP_KEYS.includes(key)) problems.push(`config file sets unknown key ${key}`);
      // Next.js would merge these on its own: one file must be the only source
      const stray = NEXT_ENV_FILES.filter((f) => fsImpl.existsSync(path.join(cwd, f)));
      if (stray.length) problems.push(`remove ${stray.join(', ')} from the app directory: with CHAINSEABASE_CONFIG_FILE it is the only configuration source`);
    }
  } else {
    const local = path.join(cwd, '.env.local');
    if (fsImpl.existsSync(local)) {
      const parsed = parseConfigText(fsImpl.readFileSync(local, 'utf8'), '.env.local');
      problems.push(...parsed.problems);
      fileValues = parsed.values;
      fileSource = '.env.local';
    }
  }

  for (const [key, value] of Object.entries(fileValues)) {
    if (!present(value)) continue;
    if (present(env[key]) && env[key] !== value) {
      problems.push(`${key} is set in both the process environment and ${fileSource} with different values`);
      continue;
    }
    values[key] = value;
    sources[key] = fileSource;
  }
  for (const key of APP_KEYS) {
    if (sources[key] || !present(env[key])) continue;
    values[key] = env[key];
    sources[key] = 'process';
  }

  const appEnv = values.APP_ENV;
  const strict = isStrict(appEnv);
  if (strict) {
    if (sources.APP_ENV !== 'config file') problems.push(`APP_ENV=${appEnv} requires CHAINSEABASE_CONFIG_FILE (the process environment and .env.local are development only)`);
    else {
      const processOnly = APP_KEYS.filter((k) => sources[k] === 'process');
      if (processOnly.length) problems.push(`set ${processOnly.join(', ')} in the config file: APP_ENV=${appEnv} does not read the process environment`);
      if (platform !== 'win32') {
        // NTFS ACLs are checked by scripts/windows/Test-ChainseabaseConfig.ps1
        const mode = fsImpl.statSync(configFile).mode & 0o777;
        if (mode & 0o077) problems.push('config file is readable or writable by group/others (use chmod 600)');
      }
    }
  }

  // one secret, one source: a password in the URL that differs from PGPASSWORD is refused
  if (present(values.PGPASSWORD)) {
    for (const name of ['DATABASE_URL', 'DIRECT_DATABASE_URL']) {
      const pw = present(values[name]) ? urlPassword(values[name]) : '';
      if (pw && pw !== values.PGPASSWORD) problems.push(`PGPASSWORD conflicts with the password in ${name}: keep the password in one place`);
    }
  }

  return { values, sources, configFile, fileSource, appEnv: appEnv ?? 'development', strict, problems };
}

/** Variable names and where they came from (never values), for `npm run config:check`. */
export function describeSources(resolved) {
  return APP_KEYS.map((name) => ({ name, source: resolved.sources[name] ?? '-' }));
}

/** Resolve and copy into process.env; on any problem print names only and exit with code 78. */
export function applyConfigOrExit() {
  const resolved = resolveConfig();
  if (resolved.problems.length) {
    console.error(`Configuration refused (${resolved.problems.length} problem${resolved.problems.length > 1 ? 's' : ''}):`);
    for (const p of resolved.problems) console.error(`  - ${p}`);
    process.exit(78); // EX_CONFIG
  }
  for (const [key, value] of Object.entries(resolved.values)) process.env[key] = value;
  return resolved;
}
