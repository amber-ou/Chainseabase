import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_KEYS, parseConfigText, resolveConfig } from '../../scripts/config/load-config.mjs';

const repo = path.resolve(import.meta.dirname, '../..');
// --import takes a URL: a bare Windows path (C:\...) would be read as the scheme "c:"
const preload = pathToFileURL(path.join(repo, 'scripts/config/preload.mjs')).href;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function tempDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-config-'));
  dirs.push(d);
  return d;
}
function writeConfig(dir: string, text: string, name = 'chainseabase.env', mode = 0o600) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  fs.chmodSync(file, mode);
  return file;
}
// placeholder values; the assertions check that they never appear in messages
const SECRET = 'value-that-must-not-leak';

describe('WIN-01 configuration file format', () => {
  it('parses KEY=VALUE with comments, quotes, BOM and CRLF; values keep # and =', () => {
    const { values, problems } = parseConfigText('\uFEFF# comment\r\n\r\nAPP_ENV=development\r\nAUTH_SESSION_SECRET="a#b=c"\r\nRESEND_FROM_EMAIL=\'Team <t@x.test>\'\r\nGOOGLE_CLIENT_ID= spaced \r\n');
    expect(problems).toEqual([]);
    expect(values).toEqual({ APP_ENV: 'development', AUTH_SESSION_SECRET: 'a#b=c', RESEND_FROM_EMAIL: 'Team <t@x.test>', GOOGLE_CLIENT_ID: 'spaced' });
  });

  it('reports bad lines and duplicates by line number or name only', () => {
    const { problems } = parseConfigText(`APP_ENV=development\nexport GOOGLE_CLIENT_SECRET=${SECRET}\nnot a line ${SECRET}\nAPP_ENV=staging\n`);
    expect(problems).toEqual(['config file line 2 is not KEY=VALUE', 'config file line 3 is not KEY=VALUE', 'config file sets APP_ENV more than once']);
    expect(problems.join(' ')).not.toContain(SECRET);
  });
});

describe('WIN-01 configuration sources and precedence', () => {
  it('development without files uses the process environment for application keys only', () => {
    const cwd = tempDir();
    const r = resolveConfig({ env: { DATABASE_URL: 'postgres://u@h/db', HOME: '/x', SOMETHING_ELSE: 'y' }, cwd });
    expect(r.problems).toEqual([]);
    expect(r.values).toEqual({ DATABASE_URL: 'postgres://u@h/db' });
    expect(r.sources).toEqual({ DATABASE_URL: 'process' });
    expect(r.strict).toBe(false);
  });

  it('development reads .env.local like next dev; a different process value is a conflict', () => {
    const cwd = tempDir();
    writeConfig(cwd, `ADMIN_ORIGIN=http://localhost:3000\nAUTH_SESSION_SECRET=${SECRET}\n`, '.env.local');
    const same = resolveConfig({ env: { ADMIN_ORIGIN: 'http://localhost:3000' }, cwd });
    expect(same.problems).toEqual([]);
    expect(same.sources).toEqual({ ADMIN_ORIGIN: '.env.local', AUTH_SESSION_SECRET: '.env.local' });
    const conflict = resolveConfig({ env: { AUTH_SESSION_SECRET: 'other-value' }, cwd });
    expect(conflict.problems).toEqual(['AUTH_SESSION_SECRET is set in both the process environment and .env.local with different values']);
    expect(conflict.problems.join(' ')).not.toContain(SECRET);
  });

  it('a config file must be absolute, exist, contain known keys only and be the only file source', () => {
    const cwd = tempDir();
    expect(resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: 'relative/chainseabase.env' }, cwd }).problems).toEqual(['CHAINSEABASE_CONFIG_FILE must be an absolute path']);
    expect(resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: path.join(cwd, 'missing.env') }, cwd }).problems).toEqual(['CHAINSEABASE_CONFIG_FILE does not exist']);
    const file = writeConfig(tempDir(), `APP_ENV=development\nGOOGLE_CLIENT_SECRT=${SECRET}\n`);
    expect(resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: file }, cwd }).problems).toEqual(['config file sets unknown key GOOGLE_CLIENT_SECRT']);
    // Next.js would merge .env.local on its own
    const ok = writeConfig(tempDir(), 'APP_ENV=development\n');
    writeConfig(cwd, 'ADMIN_ORIGIN=http://localhost:3000\n', '.env.local');
    expect(resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: ok }, cwd }).problems)
      .toEqual(['remove .env.local from the app directory: with CHAINSEABASE_CONFIG_FILE it is the only configuration source']);
  });

  it('Windows paths: drive and UNC paths are absolute, a bare file name is not', () => {
    const cwd = tempDir();
    const fakeFs = { existsSync: () => false, readFileSync: () => '', statSync: () => ({ mode: 0o600 }) } as never;
    for (const p of ['C:\\ProgramData\\Chainseabase\\config\\chainseabase.env', '\\\\server\\share\\chainseabase.env']) {
      expect(resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: p }, cwd, platform: 'win32', fsImpl: fakeFs }).problems).toEqual(['CHAINSEABASE_CONFIG_FILE does not exist']);
    }
    expect(resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: 'chainseabase.env' }, cwd, platform: 'win32', fsImpl: fakeFs }).problems).toEqual(['CHAINSEABASE_CONFIG_FILE must be an absolute path']);
  });
});

describe('WIN-01 strict environments read only the protected config file', () => {
  it('APP_ENV=staging|production from the process environment or .env.local is refused', () => {
    const cwd = tempDir();
    expect(resolveConfig({ env: { APP_ENV: 'production' }, cwd }).problems)
      .toEqual(['APP_ENV=production requires CHAINSEABASE_CONFIG_FILE (the process environment and .env.local are development only)']);
    writeConfig(cwd, 'APP_ENV=staging\n', '.env.local');
    expect(resolveConfig({ env: {}, cwd }).problems)
      .toEqual(['APP_ENV=staging requires CHAINSEABASE_CONFIG_FILE (the process environment and .env.local are development only)']);
  });

  it('application keys found only in the process environment are refused, values never printed', () => {
    const file = writeConfig(tempDir(), 'APP_ENV=production\nDATABASE_URL=postgresql://app@127.0.0.1:5432/chainseabase\n');
    const r = resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: file, GOOGLE_CLIENT_SECRET: SECRET, PGPASSWORD: SECRET }, cwd: tempDir() });
    expect(r.problems).toEqual(['set PGPASSWORD, GOOGLE_CLIENT_SECRET in the config file: APP_ENV=production does not read the process environment']);
    expect(r.problems.join(' ')).not.toContain(SECRET);
  });

  it('on POSIX the strict config file must not be group/other accessible (NTFS ACLs are checked by PowerShell)', () => {
    const dir = tempDir();
    const open = writeConfig(dir, 'APP_ENV=staging\n', 'open.env', 0o644);
    expect(resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: open }, cwd: tempDir(), platform: 'linux', fsImpl: { ...fs, statSync: () => ({ mode: 0o100644 }) } as never }).problems)
      .toEqual(['config file is readable or writable by group/others (use chmod 600)']);
    expect(resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: open }, cwd: tempDir(), platform: 'linux', fsImpl: { ...fs, statSync: () => ({ mode: 0o100600 }) } as never }).problems).toEqual([]);
    expect(resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: 'C:\\x\\c.env' }, cwd: tempDir(), platform: 'win32', fsImpl: { existsSync: (p: string) => p === 'C:\\x\\c.env', readFileSync: () => 'APP_ENV=staging\n', statSync: () => { throw new Error('mode is not checked on Windows'); } } as never }).problems).toEqual([]);
  });
});

describe('WIN-01 database password has one source', () => {
  it('URL without password + PGPASSWORD (the verified Windows flow) is accepted', () => {
    const file = writeConfig(tempDir(), `DATABASE_URL=postgresql://chainseabase_dev@127.0.0.1:5432/chainseabase_dev\nPGPASSWORD=${SECRET}\n`);
    expect(resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: file }, cwd: tempDir() }).problems).toEqual([]);
  });

  it('a URL password that differs from PGPASSWORD is refused by variable name', () => {
    const file = writeConfig(tempDir(), `DATABASE_URL=postgresql://app:pw1@127.0.0.1:5432/db\nDIRECT_DATABASE_URL=postgresql://owner:pw2@127.0.0.1:5432/db\nPGPASSWORD=${SECRET}\n`);
    const r = resolveConfig({ env: { CHAINSEABASE_CONFIG_FILE: file }, cwd: tempDir() });
    expect(r.problems).toEqual([
      'PGPASSWORD conflicts with the password in DATABASE_URL: keep the password in one place',
      'PGPASSWORD conflicts with the password in DIRECT_DATABASE_URL: keep the password in one place',
    ]);
    expect(r.problems.join(' ')).not.toMatch(/pw1|pw2|value-that/);
  });

  it('every application variable is a known key (the list matches .env.example)', () => {
    const example = fs.readFileSync(path.join(repo, '.env.example'), 'utf8');
    const { values } = parseConfigText(example.split('\n').filter((l) => !l.startsWith('#')).join('\n'));
    for (const key of Object.keys(values)) expect(APP_KEYS, key).toContain(key);
  });
});

describe('WIN-01 the same rules apply to the real preload and CLI scripts', () => {
  // no application variables; only what Node/tsx need to run (Windows derives its temp dir from these)
  const baseEnv = Object.fromEntries(Object.entries({
    PATH: process.env.PATH, Path: process.env.Path, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, NODE_ENV: 'test',
  }).filter(([, v]) => v !== undefined)) as NodeJS.ProcessEnv;

  it('node --import preload loads the file before user code; a conflict exits 78 without values', () => {
    const cwd = tempDir();
    const file = writeConfig(tempDir(), `APP_ENV=development\nAUTH_SESSION_SECRET=${SECRET}\n`);
    const probe = 'console.log(process.env.APP_ENV, process.env.AUTH_SESSION_SECRET ? "secret-loaded" : "missing")';
    const out = execFileSync(process.execPath, ['--import', preload, '-e', probe], { cwd, env: { ...baseEnv, CHAINSEABASE_CONFIG_FILE: file }, encoding: 'utf8' });
    expect(out.trim()).toBe('development secret-loaded');
    const bad = spawnSync(process.execPath, ['--import', preload, '-e', probe], { cwd, env: { ...baseEnv, CHAINSEABASE_CONFIG_FILE: file, AUTH_SESSION_SECRET: 'other' }, encoding: 'utf8' });
    expect(bad.status).toBe(78);
    expect(bad.stderr).toContain('AUTH_SESSION_SECRET is set in both the process environment and config file with different values');
    expect(bad.stderr + bad.stdout).not.toContain(SECRET);
  });

  it('npm run db:migrate path: URL without password + PGPASSWORD from the config file reaches the driver', () => {
    const db = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_test');
    const password = decodeURIComponent(db.password);
    db.password = '';
    const file = writeConfig(tempDir(), `APP_ENV=development\nDIRECT_DATABASE_URL=${db.toString()}\nPGPASSWORD=${password}\n`);
    const tsx = path.join(repo, 'node_modules/tsx/dist/cli.mjs');
    const run = spawnSync(process.execPath, [tsx, path.join(repo, 'scripts/migrate.ts')], {
      cwd: tempDir(), env: { ...baseEnv, CHAINSEABASE_CONFIG_FILE: file, TSX_TSCONFIG_PATH: path.join(repo, 'tsconfig.json') }, encoding: 'utf8',
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    // the whole output: target host and result only, no credentials
    expect(run.stdout.trim().split(/\r?\n/)).toEqual([`Migrating ${db.hostname}:${db.port || '5432'}${db.pathname}`, 'Database schema is up to date.']);
  });
});
