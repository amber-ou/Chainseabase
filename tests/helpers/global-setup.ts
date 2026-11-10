import { createSql } from '../../src/server/db';
import { migrate } from '../../scripts/migrate-lib';

/** Recreate the isolated test schema once per run, using the real migrations. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_test';
  if (!/test/.test(new URL(url).pathname)) throw new Error('Refusing to reset a database whose name does not contain "test".');
  const sql = createSql(url, 1);
  try {
    await sql.unsafe('drop schema if exists public cascade; create schema public;');
    await migrate(sql);
  } finally {
    await sql.end();
  }
}
