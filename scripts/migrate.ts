import './config/preload.mjs'; // load configuration before anything reads process.env
import { createSql } from '../src/server/db';
import { resolveScriptDatabaseUrl } from './db-url';
import { migrate } from './migrate-lib';

const { url, target } = resolveScriptDatabaseUrl(process.env, ['DIRECT_DATABASE_URL', 'DATABASE_URL']);
console.log(`Migrating ${target}`);
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
