/**
 * Database URL for the migrate/bootstrap scripts. Development may fall back to the local dev
 * database; with APP_ENV=staging|production the URL must be given explicitly, so a forgotten
 * export can never migrate the wrong database. `target` names host/port/database only, never
 * the user or password, so it can be printed before connecting.
 */
export function resolveScriptDatabaseUrl(env: Record<string, string | undefined>, names: string[]): { url: string; target: string } {
  const pick = names.map((n) => env[n]?.trim()).find(Boolean);
  const strict = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
  if (!pick && strict) throw new Error(`APP_ENV=${env.APP_ENV} requires ${names.join(' or ')}; refusing the local default.`);
  const url = pick ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_dev';
  let target: string;
  try {
    const u = new URL(url);
    target = `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    throw new Error(`${names.join(' / ')} is not a valid connection string.`);
  }
  return { url, target };
}
