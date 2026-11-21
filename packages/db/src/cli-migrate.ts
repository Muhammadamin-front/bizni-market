import { fileURLToPath } from "node:url";
import { createDb } from "./client";
import { runMigrations } from "./migrate";

const url = process.env.DATABASE_URL ?? "postgres://shop:shop@localhost:5432/shop";
const { pool } = createDb(url, { max: 2 });
await runMigrations(pool, fileURLToPath(new URL("../drizzle", import.meta.url)));
await pool.end();
console.log("migrations applied");
