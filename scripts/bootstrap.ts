import './config/preload.mjs'; // load configuration before anything reads process.env
import { createSql } from '../src/server/db';
import { resolveScriptDatabaseUrl } from './db-url';
import { bootstrap } from './bootstrap-lib';

const { url, target } = resolveScriptDatabaseUrl(process.env, ['DATABASE_URL']);
console.log(`Bootstrapping ${target}`);
const sql = createSql(url, 1);
bootstrap(sql, { teamEmail: process.env.BOOTSTRAP_TEAM_EMAIL ?? null })
  .then((r) => console.log(`Bootstrap: product ${r.productCreated ? 'created' : 'already present'}; first team grant: ${r.grant}`))
  .catch((e) => {
    console.error('Bootstrap failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
