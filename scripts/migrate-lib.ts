import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Sql } from '../src/server/db';

// resolved from this file, not the working directory: services and scheduled tasks may start elsewhere
const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations/', import.meta.url));

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Checksums a recorded migration may match. A Windows checkout usually has CRLF line endings,
 * so databases migrated there stored a CRLF checksum; the same file is LF elsewhere. Line
 * endings alone never count as a modification; new migrations record the LF form.
 */
export function migrationChecksums(content: string) {
  const lf = content.replace(/\r\n/g, '\n');
  return { record: sha256(lf), accepted: new Set([sha256(content), sha256(lf), sha256(lf.replace(/\n/g, '\r\n'))]) };
}

/** Apply db/migrations/*.sql in order, once each, recording a checksum. Safe to re-run. */
export async function migrate(sql: Sql, dir = MIGRATIONS_DIR) {
  await sql`
    create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now()
    )
  `;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const name of files) {
    const content = await readFile(path.join(dir, name), 'utf8');
    const { record, accepted } = migrationChecksums(content);
    const [done] = await sql<{ checksum: string }[]>`select checksum from schema_migrations where name = ${name}`;
    if (done) {
      if (!accepted.has(done.checksum)) throw new Error(`Migration ${name} was modified after being applied; add a new migration instead.`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`insert into schema_migrations (name, checksum) values (${name}, ${record})`;
    });
    applied.push(name);
  }
  return applied;
}
