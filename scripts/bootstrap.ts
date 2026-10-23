import { createSql } from '../src/server/db';
import { bootstrap } from './bootstrap-lib';

const url = process.env.DATABASE_URL ?? 'postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_dev';
const sql = createSql(url, 1);
bootstrap(sql, { teamEmail: process.env.BOOTSTRAP_TEAM_EMAIL ?? null })
  .then((r) => console.log(`Bootstrap: product ${r.productCreated ? 'created' : 'already present'}; first team grant: ${r.grant}`))
  .catch((e) => {
    console.error('Bootstrap failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
