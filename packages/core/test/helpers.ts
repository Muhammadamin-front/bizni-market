import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@shop/db";
import { buildMockServer, type MockMoySklad } from "@shop/mock-moysklad";
import { InMemoryLimiter, MoySkladClient } from "@shop/moysklad";
import pg from "pg";
import { createRuntime, loadEnv, type Runtime } from "../src";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://shop:shop@localhost:5432/postgres";
export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://shop:shop@localhost:5432/shop_test";
export const TEST_REDIS = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";

export async function ensureTestDatabase(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const name = new URL(TEST_DB).pathname.slice(1);
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
}

export interface TestWorld {
  rt: Runtime;
  mock: MockMoySklad;
  stop(): Promise<void>;
  reset(): Promise<void>;
  mediaDir: string;
}

/** Real Postgres + Redis + an in-process synthetic MoySklad. The limiter is relaxed (it has its own tests) so suites stay fast. */
export async function createWorld(over: Record<string, string> = {}): Promise<TestWorld> {
  await ensureTestDatabase();
  const { app, mock } = await buildMockServer();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  mock.config.publicUrl = base;
  mock.config.rateLimit.enabled = false;
  const mediaDir = await mkdtemp(path.join(tmpdir(), "shop-media-"));

  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB,
    REDIS_URL: TEST_REDIS,
    MOYSKLAD_TOKEN: "demo-token",
    MOYSKLAD_BASE_URL: `${base}/api/remap/1.2`,
    MOYSKLAD_WEBHOOK_SECRET: "test-secret",
    MEDIA_DIR: mediaDir,
    SESSION_SECRET: "x".repeat(40),
    LOG_LEVEL: "silent",
    ...over,
  });
  const rt = createRuntime(env, "test");
  rt.ms = new MoySkladClient({
    baseUrl: env.MOYSKLAD_BASE_URL,
    token: "demo-token",
    limiter: new InMemoryLimiter({ capacityUnits: 100_000, backgroundReserveUnits: 0, maxConcurrent: 20 }),
    sleep: async () => undefined,
  });
  await runMigrations(rt.pool, fileURLToPath(new URL("../../db/drizzle", import.meta.url)));

  const reset = async () => {
    await rt.pool.query(`TRUNCATE products, categories, brands, orders, customers, sync_runs, sync_state, webhook_events, integration_settings, notifications, banners, featured_slots, content_blocks, admin_users, ai_usage RESTART IDENTITY CASCADE`);
    await rt.redis.flushdb();
    mock.reset();
    mock.config.rateLimit.enabled = false;
  };
  await reset();
  return {
    rt,
    mock,
    mediaDir,
    reset,
    async stop() {
      await app.close();
      await rt.close();
    },
  };
}
