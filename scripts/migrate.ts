import { createSql } from '../src/server/db';
import { migrate } from './migrate-lib';

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_dev';
const sql = createSql(url, 1);
migrate(sql)
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database schema is up to date.');
  })
  .catch((e) => {
    console.error('Migration failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
