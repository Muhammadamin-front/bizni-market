import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, loadEnv, type Runtime } from "@shop/core";
import { runMigrations } from "@shop/db";
import { buildMockServer, type MockMoySklad } from "@shop/mock-moysklad";
import { InMemoryLimiter, MoySkladClient } from "@shop/moysklad";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { buildApp } from "../src/app";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://shop:shop@localhost:5432/postgres";
export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://shop:shop@localhost:5432/shop_api_test";
export const TEST_REDIS = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2";
export const BOT_TOKEN = "123456:TEST-bot-token";
export const ADMIN_EMAIL = "owner@shop.uz";
export const ADMIN_PASSWORD = "Str0ng-Enough-Pass!";

export interface World {
  rt: Runtime;
  mock: MockMoySklad;
  app: FastifyInstance;
  mediaDir: string;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export async function createWorld(over: Record<string, string> = {}): Promise<World> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const name = new URL(TEST_DB).pathname.slice(1);
  if ((await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const { app: mockApp, mock } = await buildMockServer();
  await mockApp.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(mockApp.server.address() as AddressInfo).port}`;
  mock.config.publicUrl = base;
  mock.config.rateLimit.enabled = false;
  const mediaDir = await mkdtemp(path.join(tmpdir(), "shop-api-media-"));

  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB,
    REDIS_URL: TEST_REDIS,
    MOYSKLAD_TOKEN: "demo-token",
    MOYSKLAD_BASE_URL: `${base}/api/remap/1.2`,
    MOYSKLAD_WEBHOOK_SECRET: "ms-webhook-secret",
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: "tg-webhook-secret",
    PUBLIC_URL: "https://shop.example.test",
    MEDIA_DIR: mediaDir,
    SESSION_SECRET: "t".repeat(48),
    LOG_LEVEL: "silent",
    ...over,
  });
  const rt = createRuntime(env, "api-test");
  rt.ms = new MoySkladClient({
    baseUrl: env.MOYSKLAD_BASE_URL,
    token: "demo-token",
    limiter: new InMemoryLimiter({ capacityUnits: 100_000, backgroundReserveUnits: 0, maxConcurrent: 20 }),
    sleep: async () => undefined,
  });
  await runMigrations(rt.pool, fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)));
  const app = await buildApp(rt);
  await app.ready();

  const reset = async () => {
    await rt.pool.query(`TRUNCATE products, categories, brands, orders, customers, sync_runs, sync_state, webhook_events, integration_settings, notifications, banners, featured_slots, content_blocks, admin_users, audit_log, ai_usage RESTART IDENTITY CASCADE`);
    await rt.redis.flushdb();
    mock.reset();
    mock.config.rateLimit.enabled = false;
  };
  await reset();
  return {
    rt,
    mock,
    app,
    mediaDir,
    reset,
    async stop() {
      await app.close();
      await mockApp.close();
      await rt.close();
    },
  };
}

export function makeInitData(user: object = { id: 42, first_name: "Ali", username: "ali", language_code: "uz" }, token = BOT_TOKEN, authDate = Math.floor(Date.now() / 1000)): string {
  const fields: Record<string, string> = { auth_date: String(authDate), query_id: "AAH-test", user: JSON.stringify(user) };
  const check = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") }).toString();
}
