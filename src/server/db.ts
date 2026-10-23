import postgres from 'postgres';
import { getConfig } from './config';

export type Sql = postgres.Sql<Record<string, never>>;
export type Tx = postgres.TransactionSql<Record<string, never>>;
/** Either the root pool or a transaction; service functions accept both. */
export type Db = Sql | Tx;

const globalForDb = globalThis as unknown as { __csbSql?: Sql; __csbSqlUrl?: string };

export function createSql(url: string, max = 10): Sql {
  return postgres(url, {
    max,
    // Supabase transaction pooler does not support prepared statements.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    transform: { column: { from: postgres.toCamel } },
    types: {
      // keep bigint (seq) as JS number; values stay far below 2^53
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  }) as unknown as Sql;
}

export function getSql(): Sql {
  const url = getConfig().databaseUrl;
  if (!globalForDb.__csbSql || globalForDb.__csbSqlUrl !== url) {
    globalForDb.__csbSql = createSql(url);
    globalForDb.__csbSqlUrl = url;
  }
  return globalForDb.__csbSql;
}

/** Replace the shared pool (tests). */
export function setSql(sql: Sql, url: string) {
  globalForDb.__csbSql = sql;
  globalForDb.__csbSqlUrl = url;
}

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getSql().begin((tx) => fn(tx as unknown as Tx)) as Promise<T>;
}
