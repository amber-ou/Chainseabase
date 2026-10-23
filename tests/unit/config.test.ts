import { afterEach, describe, expect, it } from 'vitest';
import { getConfig, resetConfigCache, siteForHost } from '@/server/config';

const saved = { ...process.env };
// placeholder values only: these tests check names and modes, never call a provider
function setDummyCredentials() {
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-client-value', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    RESEND_API_KEY: 'test-resend-value', RESEND_FROM_EMAIL: 'Test <no-reply@example.test>',
    SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-storage-value', CRON_SECRET: 'test-cron-value',
  });
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
    for (const k of ['VERCEL_ENV', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CALENDAR_PROVIDER', 'EMAIL_PROVIDER', 'STORAGE_PROVIDER']) delete process.env[k];
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
