/**
 * Runtime configuration. Only names are documented in .env.example; values come
 * from the environment (Vercel / CI secrets / ignored local .env files).
 * Secrets are never exposed to the client bundle (no NEXT_PUBLIC_ prefix).
 */

export type ProviderMode = 'real' | 'fake';

export interface AppConfig {
  databaseUrl: string;
  adminOrigin: string;
  portalOrigin: string;
  sessionSecret: string;
  tokenEncryptionKey: string | null;
  tokenEncryptionKeyVersion: number;
  tokenEncryptionPreviousKeys: string;
  googleClientId: string | null;
  googleClientSecret: string | null;
  resendApiKey: string | null;
  resendFromEmail: string | null;
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
  supabaseAvatarBucket: string;
  jobRunnerSecret: string | null;
  bootstrapTeamEmail: string | null;
  calendarProvider: ProviderMode;
  emailProvider: ProviderMode;
  storageProvider: ProviderMode;
  e2eTestLogin: boolean;
  isProductionDeployment: boolean;
}

function env(name: string): string | null {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? null : v.trim();
}

function origin(name: string, fallback: string): string {
  const raw = env(name) ?? fallback;
  const u = new URL(raw);
  return u.origin;
}

function mode(name: string, configured: boolean): ProviderMode {
  const v = env(name);
  if (v === 'fake') return 'fake';
  if (v === 'real') return 'real';
  return configured ? 'real' : 'fake';
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const isProductionDeployment = process.env.VERCEL_ENV === 'production' || env('APP_ENV') === 'production';
  const googleClientId = env('GOOGLE_CLIENT_ID');
  const googleClientSecret = env('GOOGLE_CLIENT_SECRET');
  const resendApiKey = env('RESEND_API_KEY');
  const supabaseUrl = env('SUPABASE_URL');
  const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const cfg: AppConfig = {
    databaseUrl: env('DATABASE_URL') ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_dev',
    adminOrigin: origin('ADMIN_ORIGIN', 'http://admin.localhost:3000'),
    portalOrigin: origin('PORTAL_ORIGIN', 'http://portal.localhost:3000'),
    sessionSecret: env('AUTH_SESSION_SECRET') ?? (isProductionDeployment ? '' : 'dev-only-session-secret-change-me-0123456789'),
    tokenEncryptionKey: env('TOKEN_ENCRYPTION_KEY'),
    tokenEncryptionKeyVersion: Number(env('TOKEN_ENCRYPTION_KEY_VERSION') ?? '1'),
    tokenEncryptionPreviousKeys: env('TOKEN_ENCRYPTION_PREVIOUS_KEYS') ?? '',
    googleClientId,
    googleClientSecret,
    resendApiKey,
    resendFromEmail: env('RESEND_FROM_EMAIL'),
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseAvatarBucket: env('SUPABASE_AVATAR_BUCKET') ?? 'avatars',
    jobRunnerSecret: env('JOB_RUNNER_SECRET') ?? env('CRON_SECRET'),
    bootstrapTeamEmail: env('BOOTSTRAP_TEAM_EMAIL')?.toLowerCase() ?? null,
    calendarProvider: mode('CALENDAR_PROVIDER', Boolean(googleClientId && googleClientSecret)),
    emailProvider: mode('EMAIL_PROVIDER', Boolean(resendApiKey)),
    storageProvider: mode('STORAGE_PROVIDER', Boolean(supabaseUrl && supabaseServiceRoleKey)),
    e2eTestLogin: env('E2E_TEST_LOGIN') === 'enabled' && !isProductionDeployment,
    isProductionDeployment,
  };
  if (isProductionDeployment) {
    const missing: string[] = [];
    if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) missing.push('AUTH_SESSION_SECRET');
    if (cfg.calendarProvider === 'fake' || cfg.emailProvider === 'fake' || cfg.storageProvider === 'fake') {
      missing.push('fake providers are not allowed in production');
    }
    if (missing.length) throw new Error(`Invalid production configuration: ${missing.join(', ')}`);
  }
  cached = cfg;
  return cfg;
}

/** Test helper: reset cached configuration after mutating process.env. */
export function resetConfigCache() {
  cached = null;
}

export type Site = 'admin' | 'portal';

/** Resolve the site from the Host header using an explicit allowlist. */
export function siteForHost(host: string | null | undefined): Site | null {
  if (!host) return null;
  const cfg = getConfig();
  const h = host.toLowerCase();
  if (h === new URL(cfg.adminOrigin).host) return 'admin';
  if (h === new URL(cfg.portalOrigin).host) return 'portal';
  return null;
}

export function originForSite(site: Site): string {
  const cfg = getConfig();
  return site === 'admin' ? cfg.adminOrigin : cfg.portalOrigin;
}
