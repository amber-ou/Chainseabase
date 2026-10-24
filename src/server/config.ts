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
  /** production or APP_ENV=staging: no fake providers, no test login, secrets required. */
  strictDeployment: boolean;
  deploymentEnv: 'production' | 'staging' | 'development';
}

function env(name: string): string | null {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? null : v.trim();
}

function origin(name: string, fallback: string, strict: boolean): string {
  const raw = env(name) ?? fallback;
  try {
    return new URL(raw).origin;
  } catch (e) {
    // strict deployments report the variable by name below instead of throwing its value here
    if (strict) return fallback;
    throw e;
  }
}

/**
 * Staging/production must name their database and both sites explicitly (no local defaults);
 * the two origins must be distinct HTTPS sites. Problems are reported by variable name only.
 */
function strictSiteProblems(): string[] {
  const problems: string[] = [];
  if (!env('DATABASE_URL')) problems.push('DATABASE_URL');
  const sites: URL[] = [];
  for (const name of ['ADMIN_ORIGIN', 'PORTAL_ORIGIN']) {
    const raw = env(name);
    if (!raw) { problems.push(name); continue; }
    let u: URL;
    try { u = new URL(raw); } catch { problems.push(`${name} must be a URL`); continue; }
    if (u.protocol !== 'https:') problems.push(`${name} must use https`);
    else if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) problems.push(`${name} must be an origin without path`);
    else sites.push(u);
  }
  if (sites.length === 2 && sites[0].hostname === sites[1].hostname) problems.push('ADMIN_ORIGIN and PORTAL_ORIGIN must be different sites');
  return problems;
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
  // staging runs the production guards so its results can never be a silent mock
  const strictDeployment = isProductionDeployment || env('APP_ENV') === 'staging';
  const deploymentEnv = isProductionDeployment ? 'production' : strictDeployment ? 'staging' : 'development';
  const googleClientId = env('GOOGLE_CLIENT_ID');
  const googleClientSecret = env('GOOGLE_CLIENT_SECRET');
  const resendApiKey = env('RESEND_API_KEY');
  const supabaseUrl = env('SUPABASE_URL');
  const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const cfg: AppConfig = {
    databaseUrl: env('DATABASE_URL') ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_dev',
    adminOrigin: origin('ADMIN_ORIGIN', 'http://admin.localhost:3000', strictDeployment),
    portalOrigin: origin('PORTAL_ORIGIN', 'http://portal.localhost:3000', strictDeployment),
    sessionSecret: env('AUTH_SESSION_SECRET') ?? (strictDeployment ? '' : 'dev-only-session-secret-change-me-0123456789'),
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
    e2eTestLogin: env('E2E_TEST_LOGIN') === 'enabled' && !strictDeployment,
    isProductionDeployment,
    strictDeployment,
    deploymentEnv,
  };
  if (strictDeployment) {
    const missing: string[] = strictSiteProblems();
    if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) missing.push('AUTH_SESSION_SECRET');
    if (cfg.calendarProvider === 'fake' || cfg.emailProvider === 'fake' || cfg.storageProvider === 'fake') {
      missing.push(`fake providers are not allowed in ${deploymentEnv}`);
    }
    // names only, never values
    const need = (ok: boolean, names: string) => { if (!ok) missing.push(names); };
    if (cfg.calendarProvider === 'real') need(Boolean(googleClientId && googleClientSecret && cfg.tokenEncryptionKey), 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/TOKEN_ENCRYPTION_KEY');
    if (cfg.emailProvider === 'real') need(Boolean(resendApiKey && cfg.resendFromEmail), 'RESEND_API_KEY/RESEND_FROM_EMAIL');
    if (cfg.storageProvider === 'real') need(Boolean(supabaseUrl && supabaseServiceRoleKey), 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');
    need(Boolean(cfg.jobRunnerSecret), 'CRON_SECRET');
    if (missing.length) throw new Error(`Invalid ${deploymentEnv} configuration: ${missing.join(', ')}`);
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
