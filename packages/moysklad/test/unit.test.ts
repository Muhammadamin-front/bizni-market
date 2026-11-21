import { describe, expect, it } from "vitest";
import { CircuitBreaker, InMemoryBreakerStore, InMemoryLimiter, formatMsTime, mapProduct, mapStockRows, parseMsTime, RawProduct, toMinor, toUzs } from "../src";

describe("MoySklad time", () => {
  it("reads Moscow time (UTC+3) and tolerates milliseconds", () => {
    expect(parseMsTime("2026-11-07 12:00:00").toISOString()).toBe("2026-11-07T09:00:00.000Z");
    expect(parseMsTime("2026-11-07 12:00:00.250").toISOString()).toBe("2026-11-07T09:00:00.250Z");
  });

  it("round-trips, and the offset is a parameter", () => {
    const d = new Date("2026-11-07T09:00:00.000Z");
    expect(formatMsTime(d)).toBe("2026-11-07 12:00:00");
    expect(formatMsTime(d, 0)).toBe("2026-11-07 09:00:00");
    expect(parseMsTime(formatMsTime(d, 5), 5).getTime()).toBe(d.getTime());
  });

  it("crosses midnight correctly", () => {
    expect(formatMsTime(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01 01:30:00");
  });

  it("rejects garbage loudly", () => {
    expect(() => parseMsTime("yesterday")).toThrow();
  });
});

describe("money", () => {
  it("converts between hundredths and whole so'm", () => {
    expect(toUzs(1_250_000)).toBe(12_500);
    expect(toMinor(12_500)).toBe(1_250_000);
  });
});

const baseRaw = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "  Ruchka Deli  ",
  updated: "2026-11-07 12:00:00.000",
  salePrices: [
    { value: 150_000, priceType: { id: "retail", name: "Chakana" } },
    { value: 120_000, priceType: { id: "wholesale", name: "Ulgurji" } },
    { value: 100_000, priceType: { id: "old", name: "Eski" } },
  ],
  attributes: [{ id: "brand", name: "Brend", type: "string", value: " Deli " }],
  supplier: { name: "Supplier LLC" },
  buyPrice: { value: 50_000 },
  minPrice: { value: 60_000 },
};
const cfg = { priceTypeId: "retail", oldPriceTypeId: "old", brandAttributeId: "brand", timezoneOffsetHours: 3 };

describe("mapProduct", () => {
  it("picks the configured price type and trims text", () => {
    const p = mapProduct(RawProduct.parse(baseRaw), cfg);
    expect(p.price).toBe(1500);
    expect(p.name).toBe("Ruchka Deli");
    expect(p.brandName).toBe("Deli");
  });

  it("never reports an old price that is not higher than the price", () => {
    expect(mapProduct(RawProduct.parse(baseRaw), cfg).oldPrice).toBeNull();
    const higher = { ...baseRaw, salePrices: [baseRaw.salePrices[0]!, { value: 200_000, priceType: { id: "old" } }] };
    expect(mapProduct(RawProduct.parse(higher), cfg).oldPrice).toBe(2000);
  });

  it("falls back to the supplier when the brand attribute is empty, then to null", () => {
    const noAttr = { ...baseRaw, attributes: [] };
    expect(mapProduct(RawProduct.parse(noAttr), cfg).brandName).toBe("Supplier LLC");
    expect(mapProduct(RawProduct.parse({ ...noAttr, supplier: undefined }), cfg).brandName).toBeNull();
  });

  it("returns a null price when the configured price type is missing, and has nowhere to put cost fields", () => {
    const p = mapProduct(RawProduct.parse(baseRaw), { ...cfg, priceTypeId: "missing" });
    expect(p.price).toBeNull();
    expect(Object.keys(p)).not.toContain("buyPrice");
    expect(JSON.stringify(p)).not.toContain("50000");
  });

  it("reads brand values given as an object (custom entity)", () => {
    const p = mapProduct(RawProduct.parse({ ...baseRaw, attributes: [{ id: "brand", value: { name: "Maped" } }] }), cfg);
    expect(p.brandName).toBe("Maped");
  });
});

describe("stock rows", () => {
  it("reads the requested stock type and falls back to stock", () => {
    expect(mapStockRows([{ assortmentId: "a", freeStock: 5 }], "freeStock")).toEqual([{ msId: "a", quantity: 5 }]);
    expect(mapStockRows([{ assortmentId: "a", stock: 7 }], "freeStock")).toEqual([{ msId: "a", quantity: 7 }]);
    expect(mapStockRows([{ assortmentId: "a" }], "freeStock")).toEqual([{ msId: "a", quantity: 0 }]);
  });
});

describe("InMemoryLimiter", () => {
  it("lets a burst through up to capacity, then makes the next request wait for the window", async () => {
    const limiter = new InMemoryLimiter({ capacityUnits: 4, windowMs: 120, backgroundReserveUnits: 0, maxConcurrent: 10 });
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) (await limiter.acquire(1, "interactive"))();
    expect(Date.now() - t0).toBeLessThan(50);
    (await limiter.acquire(1, "interactive"))();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it("reserves headroom for interactive work", async () => {
    const limiter = new InMemoryLimiter({ capacityUnits: 4, windowMs: 200, backgroundReserveUnits: 2, maxConcurrent: 10 });
    const t0 = Date.now();
    for (let i = 0; i < 2; i++) (await limiter.acquire(1, "background"))();
    const bgThird = limiter.acquire(1, "background").then((r) => (r(), Date.now() - t0));
    const interactive = limiter.acquire(1, "interactive").then((r) => (r(), Date.now() - t0));
    expect(await interactive).toBeLessThan(60);
    expect(await bgThird).toBeGreaterThanOrEqual(150);
  });

  it("caps requests in flight", async () => {
    const limiter = new InMemoryLimiter({ capacityUnits: 1000, windowMs: 1000, backgroundReserveUnits: 0, maxConcurrent: 2 });
    const r1 = await limiter.acquire(1, "interactive");
    await limiter.acquire(1, "interactive");
    let third = false;
    const p = limiter.acquire(1, "interactive").then(() => (third = true));
    await new Promise((r) => setTimeout(r, 80));
    expect(third).toBe(false);
    r1();
    await p;
    expect(third).toBe(true);
  });
});

describe("CircuitBreaker", () => {
  it("opens at the threshold, reports the reopening time, and can be reset", async () => {
    let openedAt = 0;
    const breaker = new CircuitBreaker(new InMemoryBreakerStore(), { failureThreshold: 3, windowMs: 1000, openMs: 5000 }, (until) => (openedAt = until));
    await breaker.recordFailure();
    await breaker.recordFailure();
    expect(await breaker.openUntil()).toBe(0);
    await breaker.recordFailure();
    expect(await breaker.openUntil()).toBeGreaterThan(Date.now());
    expect(openedAt).toBeGreaterThan(Date.now());
    await breaker.reset();
    expect(await breaker.openUntil()).toBe(0);
  });
});
