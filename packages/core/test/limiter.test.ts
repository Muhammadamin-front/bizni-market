import { RedisLimiter } from "@shop/moysklad";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { redisOptions } from "../src";
import { TEST_REDIS } from "./helpers";

let redis: Redis;
beforeAll(async () => {
  redis = new Redis(redisOptions(TEST_REDIS));
  await redis.flushdb();
});
afterAll(() => {
  redis.disconnect();
});

describe("RedisLimiter (the budget shared by api and worker)", () => {
  it("lets a window's worth through at once, then spaces the rest", async () => {
    const limiter = new RedisLimiter(redis as never, { capacityUnits: 6, windowMs: 400, backgroundReserveUnits: 0, maxConcurrent: 50 }, "t:window");
    const t0 = Date.now();
    for (let i = 0; i < 6; i++) (await limiter.acquire(1, "interactive"))();
    expect(Date.now() - t0).toBeLessThan(200);
    (await limiter.acquire(1, "interactive"))();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(350);
  });

  it("two limiter instances (two processes) share one budget", async () => {
    const a = new RedisLimiter(redis as never, { capacityUnits: 4, windowMs: 400, backgroundReserveUnits: 0, maxConcurrent: 50 }, "t:shared");
    const b = new RedisLimiter(redis as never, { capacityUnits: 4, windowMs: 400, backgroundReserveUnits: 0, maxConcurrent: 50 }, "t:shared");
    const t0 = Date.now();
    for (let i = 0; i < 2; i++) (await a.acquire(1, "interactive"))();
    for (let i = 0; i < 2; i++) (await b.acquire(1, "interactive"))();
    expect(Date.now() - t0).toBeLessThan(200);
    (await a.acquire(1, "interactive"))(); // fifth request across both
    expect(Date.now() - t0).toBeGreaterThanOrEqual(350);
  });

  it("caps requests in flight across instances and frees the slot on release", async () => {
    const lim = new RedisLimiter(redis as never, { capacityUnits: 1000, windowMs: 1000, backgroundReserveUnits: 0, maxConcurrent: 2 }, "t:flight");
    const r1 = await lim.acquire(1, "interactive");
    await lim.acquire(1, "interactive");
    let third = false;
    const p = lim.acquire(1, "interactive").then(() => (third = true));
    await new Promise((r) => setTimeout(r, 100));
    expect(third).toBe(false);
    r1();
    await p;
    expect(third).toBe(true);
  });

  it("holds back background work so interactive requests keep headroom", async () => {
    const lim = new RedisLimiter(redis as never, { capacityUnits: 4, windowMs: 400, backgroundReserveUnits: 2, maxConcurrent: 50 }, "t:lanes");
    const t0 = Date.now();
    for (let i = 0; i < 2; i++) (await lim.acquire(1, "background"))();
    const bg = lim.acquire(1, "background").then((r) => (r(), Date.now() - t0));
    const interactive = lim.acquire(1, "interactive").then((r) => (r(), Date.now() - t0));
    expect(await interactive).toBeLessThan(150);
    expect(await bg).toBeGreaterThanOrEqual(300);
  });
});
