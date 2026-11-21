import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// numeric/bigint come back as strings by default; the columns declared with mode "number" are parsed by drizzle,
// but raw `sql` aggregates are not, so make plain int8 parsing safe for our value ranges (UZS totals stay far below 2^53).
pg.types.setTypeParser(20, (v) => Number(v));

export interface DbHandle {
  db: ReturnType<typeof createDrizzle>;
  pool: pg.Pool;
}

function createDrizzle(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDrizzle>;

export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10, idleTimeoutMillis: 30_000 });
  return { db: createDrizzle(pool), pool };
}
