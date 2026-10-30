// Test environment: isolated database, fake third-party providers, no real secrets.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_test';
process.env.ADMIN_ORIGIN = 'http://admin.test.local';
process.env.PORTAL_ORIGIN = 'http://portal.test.local';
process.env.AUTH_SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijklmnop';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.TOKEN_ENCRYPTION_KEY_VERSION = '1';
process.env.CALENDAR_PROVIDER = 'fake';
process.env.EMAIL_PROVIDER = 'fake';
process.env.STORAGE_PROVIDER = 'fake';
process.env.JOB_RUNNER_SECRET = 'test-job-secret';
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.VERCEL_ENV;
// a developer machine or CI may carry these (e.g. a machine-wide CHAINSEABASE_CONFIG_FILE on the
// Windows host, APP_ENV from a staging shell): tests always run as an isolated development setup
delete process.env.APP_ENV;
delete process.env.CHAINSEABASE_CONFIG_FILE;
delete process.env.DIRECT_DATABASE_URL;
// PGPASSWORD stays: TEST_DATABASE_URL may omit the password, as on the Windows host
