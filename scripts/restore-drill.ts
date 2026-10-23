/**
 * O03 restore drill: dump SOURCE_DATABASE_URL with pg_dump, restore into an isolated
 * TARGET_DATABASE_URL (database name must contain "drill") and compare every table's
 * row count plus a checksum of private data. Never point TARGET at production.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSql } from '../src/server/db';

const source = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL;
const target = process.env.TARGET_DATABASE_URL;
if (!source || !target) {
  console.error('Set SOURCE_DATABASE_URL (or DATABASE_URL) and TARGET_DATABASE_URL.');
  process.exit(1);
}
if (!/drill/.test(new URL(target).pathname)) {
  console.error('Refusing: the target database name must contain "drill" (isolated restore target).');
  process.exit(1);
}

async function snapshot(url: string) {
  const sql = createSql(url, 1);
  try {
    const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public' order by tablename`;
    const counts: Record<string, number> = {};
    for (const t of tables) counts[t.tablename] = Number((await sql.unsafe(`select count(*)::int as c from "${t.tablename}"`))[0].c);
    const [privateDigest] = await sql<{ d: string | null }[]>`
      select md5(string_agg(x, '|' order by x)) as d from (
        select 'pv:' || id::text || ':' || revision as x from personal_views
        union all select 'pp:' || view_id::text || ':' || feedback_id::text || ':' || column_id::text from personal_placements
        union all select 'pt:' || id::text || ':' || name from personal_tags
        union all select 'gc:' || user_id::text || ':' || coalesce(encrypted_refresh_token, '') from google_credentials
        union all select 'fb:' || id::text || ':' || revision || ':' || visibility from feedback
      ) s
    `;
    return { counts, privateDigest: privateDigest.d };
  } finally {
    await sql.end();
  }
}

async function main() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'csb-drill-'));
  const dump = path.join(dir, 'backup.dump');
  const started = Date.now();
  try {
    const before = await snapshot(source!);
    execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--file=${dump}`, source!], { stdio: 'inherit' });
    const t = createSql(target!, 1);
    await t.unsafe('drop schema if exists public cascade; create schema public;');
    await t.end();
    execFileSync('pg_restore', ['--no-owner', '--no-privileges', `--dbname=${target}`, dump], { stdio: 'inherit' });
    const after = await snapshot(target!);
    const mismatches = Object.keys(before.counts).filter((k) => before.counts[k] !== after.counts[k]);
    const report = {
      at: new Date().toISOString(),
      tables: Object.keys(before.counts).length,
      rows: Object.values(before.counts).reduce((a, b) => a + b, 0),
      mismatches,
      privateDataDigestMatches: before.privateDigest === after.privateDigest,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    };
    console.log(JSON.stringify(report, null, 2));
    if (mismatches.length || !report.privateDataDigestMatches) process.exitCode = 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
