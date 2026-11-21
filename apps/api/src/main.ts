import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { bootstrapAdmin, createRuntime, loadEnv } from "@shop/core";
import { runMigrations } from "@shop/db";
import { buildApp } from "./app";

const env = loadEnv();
const rt = createRuntime(env, "api");

// Migrations ship next to the bundle in the image (./drizzle) and in packages/db/drizzle in the repo.
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [path.resolve(here, "../drizzle"), path.resolve(here, "../../../packages/db/drizzle"), path.resolve(process.cwd(), "drizzle")];
const migrations = candidates.find((p) => existsSync(path.join(p, "meta/_journal.json")));
if (!migrations) throw new Error(`migrations folder not found (looked in ${candidates.join(", ")})`);
await runMigrations(rt.pool, migrations);
await bootstrapAdmin(rt);

const app = await buildApp(rt);
await app.listen({ port: env.API_PORT, host: env.API_HOST });

const shutdown = async (signal: string) => {
  rt.log.info({ signal }, "shutting down");
  await app.close();
  await rt.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
