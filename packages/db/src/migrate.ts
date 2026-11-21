import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";

const LOCK_ID = 727_274;

/**
 * Applies pending migrations under a Postgres advisory lock: api and worker both call this on boot,
 * and two concurrent migrators must not race. pg_trgm is created here because migrations assume it.
 */
export async function runMigrations(pool: pg.Pool, migrationsFolder: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]);
    } finally {
      client.release();
    }
  }
}
