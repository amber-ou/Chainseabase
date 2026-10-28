import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { avatarStorageDirProblem, getConfig, resetConfigCache, siteForHost } from '@/server/config';

const saved = { ...process.env };
// placeholder values only: these tests check names and modes, never call a provider
function setDummyCredentials() {
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-client-value', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    RESEND_API_KEY: 'test-resend-value', RESEND_FROM_EMAIL: 'Test <no-reply@example.test>',
    SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-storage-value', CRON_SECRET: 'test-cron-value',
    DATABASE_URL: 'postgres://user:pw@db.example.test:6543/postgres?sslmode=require',
    ADMIN_ORIGIN: 'https://staging-admin.example.test', PORTAL_ORIGIN: 'https://staging-feedback.example.test',
  });
}
// a staging deployment with every required variable except the ones a test removes or changes
function strictStaging() {
  for (const k of ['VERCEL_ENV', 'E2E_TEST_LOGIN']) delete process.env[k];
  Object.assign(process.env, { APP_ENV: 'staging', AUTH_SESSION_SECRET: 'x'.repeat(40), CALENDAR_PROVIDER: 'real', EMAIL_PROVIDER: 'real', STORAGE_PROVIDER: 'real' });
  setDummyCredentials();
}
afterEach(() => {
  process.env = { ...saved };
  resetConfigCache();
});

describe('O01 environment separation guards', () => {
  it('refuses fake providers and a missing session secret in production deployments', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.AUTH_SESSION_SECRET = 'x'.repeat(40);
    process.env.CALENDAR_PROVIDER = 'fake';
    resetConfigCache();
    expect(() => getConfig()).toThrow(/fake providers are not allowed/);
    delete process.env.AUTH_SESSION_SECRET;
    process.env.CALENDAR_PROVIDER = 'real';
    process.env.EMAIL_PROVIDER = 'real';
    process.env.STORAGE_PROVIDER = 'real';
    resetConfigCache();
    expect(() => getConfig()).toThrow(/AUTH_SESSION_SECRET/);
  });

  it('never enables the test login on a production deployment', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.AUTH_SESSION_SECRET = 'x'.repeat(40);
    process.env.CALENDAR_PROVIDER = 'real';
    process.env.EMAIL_PROVIDER = 'real';
    process.env.STORAGE_PROVIDER = 'real';
    setDummyCredentials();
    process.env.E2E_TEST_LOGIN = 'enabled';
    resetConfigCache();
    expect(getConfig().e2eTestLogin).toBe(false);
  });

  it('APP_ENV=staging runs the production guards: no fakes, no test login, credentials required', () => {
    for (const k of ['VERCEL_ENV', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CALENDAR_PROVIDER', 'EMAIL_PROVIDER', 'STORAGE_PROVIDER', 'DATABASE_URL', 'ADMIN_ORIGIN', 'PORTAL_ORIGIN']) delete process.env[k];
    process.env.APP_ENV = 'staging';
    process.env.AUTH_SESSION_SECRET = 'x'.repeat(40);
    resetConfigCache();
    // no credentials: providers would silently default to fake, which staging refuses
    expect(() => getConfig()).toThrow(/Invalid staging configuration: .*fake providers are not allowed in staging/);
    process.env.CALENDAR_PROVIDER = 'real';
    process.env.EMAIL_PROVIDER = 'real';
    process.env.STORAGE_PROVIDER = 'real';
    resetConfigCache();
    // real mode without its credentials is named (names only, never values)
    expect(() => getConfig()).toThrow(/GOOGLE_CLIENT_ID\/GOOGLE_CLIENT_SECRET\/TOKEN_ENCRYPTION_KEY.*RESEND_API_KEY\/RESEND_FROM_EMAIL.*SUPABASE_URL\/SUPABASE_SERVICE_ROLE_KEY/);
    setDummyCredentials();
    process.env.E2E_TEST_LOGIN = 'enabled';
    resetConfigCache();
    const cfg = getConfig();
    expect(cfg.deploymentEnv).toBe('staging');
    expect(cfg.isProductionDeployment).toBe(false);
    expect(cfg.e2eTestLogin).toBe(false);
    expect([cfg.calendarProvider, cfg.emailProvider, cfg.storageProvider]).toEqual(['real', 'real', 'real']);
  });

  it('staging requires DATABASE_URL, ADMIN_ORIGIN and PORTAL_ORIGIN explicitly (no local defaults)', () => {
    strictStaging();
    for (const k of ['DATABASE_URL', 'ADMIN_ORIGIN', 'PORTAL_ORIGIN']) delete process.env[k];
    resetConfigCache();
    expect(() => getConfig()).toThrow(/Invalid staging configuration: DATABASE_URL, ADMIN_ORIGIN, PORTAL_ORIGIN/);
    // blank values count as missing too
    Object.assign(process.env, { DATABASE_URL: '  ', ADMIN_ORIGIN: '', PORTAL_ORIGIN: ' ' });
    resetConfigCache();
    expect(() => getConfig()).toThrow(/DATABASE_URL, ADMIN_ORIGIN, PORTAL_ORIGIN/);
    // development keeps its local defaults
    delete process.env.APP_ENV;
    resetConfigCache();
    expect(getConfig().adminOrigin).toBe('http://admin.localhost:3000');
  });

  it('staging origins must be two different HTTPS sites without a path; errors name variables, never values', () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ ADMIN_ORIGIN: 'http://staging-admin.example.test' }, /ADMIN_ORIGIN must use https/],
      [{ PORTAL_ORIGIN: 'http://localhost:3000' }, /PORTAL_ORIGIN must use https/],
      [{ ADMIN_ORIGIN: 'https://staging-admin.example.test/admin' }, /ADMIN_ORIGIN must be an origin without path/],
      [{ PORTAL_ORIGIN: 'not a url secret-ish' }, /PORTAL_ORIGIN must be a URL/],
      [{ PORTAL_ORIGIN: 'https://staging-admin.example.test' }, /ADMIN_ORIGIN and PORTAL_ORIGIN must be different sites/],
      [{ PORTAL_ORIGIN: 'https://staging-admin.example.test:8443' }, /ADMIN_ORIGIN and PORTAL_ORIGIN must be different sites/],
    ];
    for (const [patch, expected] of cases) {
      strictStaging();
      Object.assign(process.env, patch);
      resetConfigCache();
      let message = '';
      try { getConfig(); } catch (e) { message = (e as Error).message; }
      expect(message).toMatch(expected);
      for (const value of Object.values(patch)) expect(message).not.toContain(value);
    }
    // a trailing slash is still an origin
    strictStaging();
    process.env.ADMIN_ORIGIN = 'https://staging-admin.example.test/';
    resetConfigCache();
    expect(getConfig().adminOrigin).toBe('https://staging-admin.example.test');
  });

  it('production applies the same database and site requirements', () => {
    strictStaging();
    delete process.env.APP_ENV;
    process.env.VERCEL_ENV = 'production';
    delete process.env.DATABASE_URL;
    process.env.ADMIN_ORIGIN = 'http://admin.example.test';
    resetConfigCache();
    expect(() => getConfig()).toThrow(/Invalid production configuration: DATABASE_URL, ADMIN_ORIGIN must use https/);
  });

  it('the connection string is used exactly as given (its parameters are kept)', () => {
    strictStaging();
    resetConfigCache();
    expect(getConfig().databaseUrl).toBe('postgres://user:pw@db.example.test:6543/postgres?sslmode=require');
  });

  it('resolves sites only from the explicit host allowlist', () => {
    process.env.ADMIN_ORIGIN = 'https://admin.example.com';
    process.env.PORTAL_ORIGIN = 'https://feedback.example.com';
    resetConfigCache();
    expect(siteForHost('admin.example.com')).toBe('admin');
    expect(siteForHost('FEEDBACK.example.com')).toBe('portal');
    expect(siteForHost('evil.example.com')).toBeNull();
    expect(siteForHost('admin.example.com.evil.net')).toBeNull();
  });
});

describe('WIN-02 avatar storage backend configuration', () => {
  const outside = path.resolve(process.cwd(), '..', 'csb-avatar-root-outside-app');
  function staging(storage: Record<string, string>) {
    strictStaging();
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STORAGE_PROVIDER', 'AVATAR_STORAGE_DIR']) delete process.env[k];
    Object.assign(process.env, storage);
    resetConfigCache();
  }
  function problem(): string {
    try { getConfig(); return ''; } catch (e) { return (e as Error).message; }
  }

  it('staging accepts the filesystem backend without any Supabase settings and reports it accurately', () => {
    staging({ STORAGE_PROVIDER: 'filesystem', AVATAR_STORAGE_DIR: outside });
    const cfg = getConfig();
    expect([cfg.storageProvider, cfg.storageBackend, cfg.avatarStorageDir]).toEqual(['real', 'filesystem', outside]);
    // AVATAR_STORAGE_DIR alone selects filesystem
    staging({ AVATAR_STORAGE_DIR: outside });
    expect(getConfig().storageBackend).toBe('filesystem');
  });

  it('staging still refuses the fake storage double (explicit or by default)', () => {
    staging({ STORAGE_PROVIDER: 'fake' });
    expect(problem()).toMatch(/fake providers are not allowed in staging/);
    staging({});
    expect(problem()).toMatch(/fake providers are not allowed in staging/);
  });

  it('filesystem needs an absolute directory outside the application directory; errors never show the path', () => {
    const cases: [string | undefined, RegExp][] = [
      [undefined, /AVATAR_STORAGE_DIR \(required for STORAGE_PROVIDER=filesystem\)/],
      ['relative/avatars', /AVATAR_STORAGE_DIR must be an absolute local directory/],
      [path.join(process.cwd(), '.data', 'avatars'), /AVATAR_STORAGE_DIR must be outside the application directory/],
      [process.cwd(), /AVATAR_STORAGE_DIR must be outside the application directory/],
    ];
    for (const [dir, expected] of cases) {
      staging(dir === undefined ? { STORAGE_PROVIDER: 'filesystem' } : { STORAGE_PROVIDER: 'filesystem', AVATAR_STORAGE_DIR: dir });
      const message = problem();
      expect(message).toMatch(expected);
      if (dir) expect(message).not.toContain(dir);
    }
  });

  it('the same storage rules apply in development (the reported mode is the one in use)', () => {
    for (const k of ['APP_ENV', 'VERCEL_ENV', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
    Object.assign(process.env, { STORAGE_PROVIDER: 'filesystem', AVATAR_STORAGE_DIR: 'relative' });
    resetConfigCache();
    expect(problem()).toMatch(/Invalid development configuration: AVATAR_STORAGE_DIR must be an absolute local directory/);
    process.env.STORAGE_PROVIDER = 'supabase';
    resetConfigCache();
    expect(problem()).toMatch(/SUPABASE_URL\/SUPABASE_SERVICE_ROLE_KEY/);
    process.env.STORAGE_PROVIDER = 'disk';
    resetConfigCache();
    expect(problem()).toMatch(/STORAGE_PROVIDER must be filesystem, supabase or fake/);
    process.env.STORAGE_PROVIDER = 'fake';
    resetConfigCache();
    expect([getConfig().storageProvider, getConfig().storageBackend]).toEqual(['fake', 'fake']);
  });

  it('the legacy Supabase adapter is kept: STORAGE_PROVIDER=real still means supabase', () => {
    staging({ STORAGE_PROVIDER: 'real', SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-storage-value' });
    expect([getConfig().storageProvider, getConfig().storageBackend]).toEqual(['real', 'supabase']);
    staging({ STORAGE_PROVIDER: 'real' });
    expect(problem()).toMatch(/SUPABASE_URL\/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('Windows roots must be local drive paths outside the program directory', () => {
    const app = 'C:\\Apps\\Chainseabase';
    const check = (dir: string) => avatarStorageDirProblem(dir, 'win32', app);
    expect(check('C:\\ProgramData\\Chainseabase\\data\\avatars')).toBeNull();
    expect(check('D:/ChainseabaseData/avatars')).toBeNull();
    for (const dir of ['\\\\server\\share\\avatars', '\\\\?\\C:\\avatars', '\\\\.\\C:\\avatars', 'C:avatars', '\\avatars', 'avatars']) {
      expect(check(dir), dir).toBe('AVATAR_STORAGE_DIR must be an absolute local directory');
    }
    for (const dir of ['C:\\Apps\\Chainseabase\\.data\\avatars', 'c:\\apps\\chainseabase', 'C:\\Apps\\Chainseabase\\']) {
      expect(check(dir), dir).toBe('AVATAR_STORAGE_DIR must be outside the application directory');
    }
    // a sibling whose name only starts like the app directory is outside it
    expect(check('C:\\Apps\\Chainseabase-data\\avatars')).toBeNull();
    expect(avatarStorageDirProblem('/srv/chainseabase-data/avatars', 'linux', '/srv/chainseabase')).toBeNull();
    expect(avatarStorageDirProblem('/srv/chainseabase/data', 'linux', '/srv/chainseabase')).toBe('AVATAR_STORAGE_DIR must be outside the application directory');
  });
});
