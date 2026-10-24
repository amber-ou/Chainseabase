import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Sql } from '../src/server/db';

/** Apply db/migrations/*.sql in order, once each, recording a checksum. Safe to re-run. */
export async function migrate(sql: Sql, dir = path.join(process.cwd(), 'db', 'migrations')) {
  await sql`
    create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now()
    )
  `;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const name of files) {
    const content = await readFile(path.join(dir, name), 'utf8');
    const checksum = createHash('sha256').update(content).digest('hex');
    const [done] = await sql<{ checksum: string }[]>`select checksum from schema_migrations where name = ${name}`;
    if (done) {
      if (done.checksum !== checksum) throw new Error(`Migration ${name} was modified after being applied; add a new migration instead.`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`insert into schema_migrations (name, checksum) values (${name}, ${checksum})`;
    });
    applied.push(name);
  }
  return applied;
}
