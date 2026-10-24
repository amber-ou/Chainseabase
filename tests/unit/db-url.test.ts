import { describe, expect, it } from 'vitest';
import { resolveScriptDatabaseUrl } from '../../scripts/db-url';

describe('migrate/bootstrap database target', () => {
  it('staging and production refuse the local default', () => {
    for (const APP_ENV of ['staging', 'production']) {
      expect(() => resolveScriptDatabaseUrl({ APP_ENV }, ['DIRECT_DATABASE_URL', 'DATABASE_URL'])).toThrow(/requires DIRECT_DATABASE_URL or DATABASE_URL/);
      expect(() => resolveScriptDatabaseUrl({ APP_ENV, DATABASE_URL: '  ' }, ['DATABASE_URL'])).toThrow(/refusing the local default/);
    }
  });

  it('development keeps the local default', () => {
    expect(resolveScriptDatabaseUrl({}, ['DATABASE_URL']).target).toBe('127.0.0.1:5432/chainseabase_dev');
  });

  it('uses the first given URL unchanged and prints the target without credentials', () => {
    const direct = 'postgres://postgres.ref:pw-secret@aws-0-ap.pooler.example.test:5432/postgres?sslmode=require';
    const r = resolveScriptDatabaseUrl({ APP_ENV: 'staging', DIRECT_DATABASE_URL: direct, DATABASE_URL: 'postgres://x@other.test:6543/postgres' }, ['DIRECT_DATABASE_URL', 'DATABASE_URL']);
    expect(r.url).toBe(direct);
    expect(r.target).toBe('aws-0-ap.pooler.example.test:5432/postgres');
    expect(r.target).not.toContain('pw-secret');
    expect(r.target).not.toContain('postgres.ref');
  });

  it('an invalid connection string is reported by variable name only', () => {
    let message = '';
    try { resolveScriptDatabaseUrl({ DATABASE_URL: 'not a url pw-secret' }, ['DATABASE_URL']); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/DATABASE_URL is not a valid connection string/);
    expect(message).not.toContain('pw-secret');
  });
});
