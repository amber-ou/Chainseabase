import { afterEach, describe, expect, it } from 'vitest';
import { getConfig, resetConfigCache, siteForHost } from '@/server/config';

const saved = { ...process.env };
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
    process.env.E2E_TEST_LOGIN = 'enabled';
    resetConfigCache();
    expect(getConfig().e2eTestLogin).toBe(false);
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
