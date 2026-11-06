import { createSql } from '../../src/server/db';
import { migrate } from '../../scripts/migrate-lib';
import { bootstrap } from '../../scripts/bootstrap-lib';

/** Fresh isolated E2E database: real migrations + production bootstrap, no demo seed. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_e2e';
  if (!/e2e/.test(new URL(url).pathname)) throw new Error('Refusing to reset a non-e2e database.');
  const sql = createSql(url, 1);
  try {
    await sql.unsafe('drop schema if exists public cascade; create schema public;');
    await migrate(sql);
    await bootstrap(sql, { teamEmail: 'lead@e2e.test' });
    // an invited tester (product 1) and an uninvited Google account, as test logins
    const [p] = await sql<{ id: string }[]>`select id from products where system_key = 'initial'`;
    const [t] = await sql<{ id: string }[]>`insert into users (google_sub, verified_email, display_name, role) values ('test-tester@e2e.test', 'tester@e2e.test', '測試者', 'tester') returning id`;
    await sql`insert into product_access (user_id, product_id) values (${t.id}, ${p.id})`;
  } finally {
    await sql.end();
  }
}
