import type { Sql } from '../src/server/db';
import { createProduct } from '../src/modules/products/service';

/**
 * Production-safe initialization (idempotent): the initial product with its
 * defaults and the deployment-designated first team email. No demo data.
 */
export async function bootstrap(sql: Sql, opts: { teamEmail: string | null }) {
  return sql.begin(async (tx) => {
    // serialize concurrent bootstrap runs
    await tx`select pg_advisory_xact_lock(7340002)`;
    const [existing] = await tx<{ id: string }[]>`select id from products where system_key = 'initial'`;
    let productCreated = false;
    if (!existing) {
      await createProduct(tx as never, { name: '產品1', systemKey: 'initial' });
      productCreated = true;
    }
    let grant: 'created' | 'exists' | 'skipped_team_exists' | 'not_configured' = 'not_configured';
    if (opts.teamEmail) {
      const email = opts.teamEmail.trim().toLowerCase();
      const [team] = await tx`select 1 from users where role = 'team' and membership_state = 'active' limit 1`;
      if (team) grant = 'skipped_team_exists';
      else {
        const ins = await tx`insert into bootstrap_team_grants (email) values (${email}) on conflict do nothing returning email`;
        grant = ins.length ? 'created' : 'exists';
      }
    }
    return { productCreated, grant };
  });
}
