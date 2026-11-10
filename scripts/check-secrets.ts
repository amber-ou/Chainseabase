/**
 * O04 guard: fail if a secret value or a well-known secret pattern appears in the
 * client bundle (.next/static) or in git-tracked files. Run after `npm run build`.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const SECRET_ENV = ['GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TOKEN_ENCRYPTION_KEY', 'AUTH_SESSION_SECRET', 'JOB_RUNNER_SECRET', 'CRON_SECRET', 'TOKEN_ENCRYPTION_PREVIOUS_KEYS'];
const PATTERNS: [string, RegExp][] = [
  ['Google OAuth client secret', /GOCSPX-[A-Za-z0-9_-]{10,}/],
  ['Resend API key', /\bre_[A-Za-z0-9]{20,}\b/],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ['Postgres URL with password', /postgres(?:ql)?:\/\/[^:\s/]+:(?!chainsea@)[^@\s]{6,}@(?!127\.0\.0\.1|localhost)/],
];

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files: { file: string; scope: string }[] = [];
if (existsSync('.next/static')) for (const f of walk('.next/static')) files.push({ file: f, scope: 'client bundle' });
else console.warn('warning: .next/static not found; run `npm run build` first to scan the client bundle');
for (const f of execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)) {
  if (f.endsWith('.png') || f === 'package-lock.json') continue;
  files.push({ file: f, scope: 'git' });
}

const values = SECRET_ENV.map((k) => [k, process.env[k]] as const).filter(([, v]) => v && v.length >= 12);
const problems: string[] = [];
for (const { file, scope } of files) {
  const text = readFileSync(file, 'utf8');
  for (const [name, v] of values) if (text.includes(v!)) problems.push(`${scope}: ${file} contains the value of ${name}`);
  for (const [label, re] of PATTERNS) if (re.test(text) && !file.startsWith('scripts/check-secrets')) problems.push(`${scope}: ${file} matches ${label}`);
  // variable names may appear in help text; credential columns and values must not
  if (scope === 'client bundle' && /encrypted_refresh_token|token_hash|id_hash/.test(text)) {
    problems.push(`client bundle: ${file} references a credential column`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Secret scan passed: ${files.length} files checked (${values.length} configured secret values compared).`);
