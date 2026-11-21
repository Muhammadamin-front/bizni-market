import { readdir } from "node:fs/promises";
import { brands, categories, count, eq, productImages, products, stockLevels, syncRuns, webhookEvents } from "@shop/db";
import { IDS } from "@shop/mock-moysklad";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  autoConfigure,
  fullSync,
  loadSettings,
  processWebhookEvents,
  recordWebhook,
  reconcileProducts,
  saveSettings,
  syncFolders,
  syncImages,
  syncProducts,
  syncStock,
} from "../src";
import { createWorld, type TestWorld } from "./helpers";

let w: TestWorld;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.stop();
});
beforeEach(async () => {
  await w.reset();
});

async function n(table: typeof products | typeof categories | typeof brands | typeof productImages | typeof stockLevels): Promise<number> {
  const [row] = await w.rt.db.select({ c: count() }).from(table);
  return Number(row?.c ?? 0);
}

describe("auto-configuration", () => {
  it("picks only unambiguous defaults and warns about the rest", async () => {
    const report = await autoConfigure(w.rt);
    expect(report?.settings.organizationId).toBe(IDS.organization); // exactly one organisation
    expect(report?.settings.priceTypeId).toBe(IDS.priceRetail); // exactly one price type is named like a retail price
    expect(report?.settings.brandAttributeId).toBe(IDS.brandAttr);
    expect(report?.settings.oldPriceTypeId).toBe(IDS.priceOld);
    expect(report?.settings.orderStoreId).toBe(""); // two stores: the owner must choose
    expect(report?.settings.initialStateId).toBeTruthy();
  });

  it("never overwrites what the owner already chose", async () => {
    await saveSettings(w.rt, { priceTypeId: IDS.priceWholesale });
    const report = await autoConfigure(w.rt);
    expect(report?.settings.priceTypeId).toBe(IDS.priceWholesale);
  });
});

describe("full sync from the synthetic MoySklad", () => {
  it("imports folders, products, brands and stock, and is idempotent", async () => {
    await fullSync(w.rt, "manual");
    const total = w.mock.dataset.products.length;
    expect(await n(categories)).toBe(w.mock.dataset.folders.length);
    expect(await n(products)).toBe(total);
    expect(await n(brands)).toBeGreaterThan(10);
    expect(await n(stockLevels)).toBeGreaterThan(total / 2);

    const [p] = await w.rt.db.select().from(products).where(eq(products.msId, w.mock.dataset.products[0]!.id));
    expect(p!.price).toBe(w.mock.dataset.products[0]!.priceMinor / 100);
    expect(p!.firstSeenAt).toBeNull(); // initial import: nothing is "new"
    expect(p!.slug).toMatch(/-[0-9a-f]{8}$/);
    expect(p!.nameSearch.length).toBeGreaterThan(3);

    const archivedInMock = w.mock.dataset.products.filter((x) => x.archived).length;
    const archived = (await w.rt.db.select().from(products).where(eq(products.archived, true))).length;
    expect(archived).toBe(archivedInMock);

    const runsBefore = await n(products);
    await fullSync(w.rt, "manual");
    expect(await n(products)).toBe(runsBefore); // no duplicates
    const runs = await w.rt.db.select().from(syncRuns);
    expect(runs.every((r) => r.status === "ok")).toBe(true);
  });

  it("downloads images and stores three WebP sizes under content-hashed keys", async () => {
    await syncFolders(w.rt, "manual");
    await syncProducts(w.rt, "manual", "full");
    // keep the test quick: only process the first products' images
    await w.rt.db.execute(`DELETE FROM product_images WHERE id NOT IN (SELECT id FROM product_images ORDER BY id LIMIT 6)` as never);
    await syncImages(w.rt, "manual");
    const ready = await w.rt.db.select().from(productImages).where(eq(productImages.status, "ready"));
    expect(ready.length).toBe(6);
    expect(ready[0]!.storageKey).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{20}$/);
    expect(ready[0]!.width).toBeGreaterThan(100);
    const dir = ready[0]!.storageKey!.split("/")[0]!;
    const files = await readdir(`${w.mediaDir}/${dir}`);
    expect(files.filter((f) => f.endsWith(".webp")).length).toBeGreaterThanOrEqual(3);
  });
});

describe("ordering of scheduled jobs", () => {
  it("links categories even when products are synced before folders (first-boot race)", async () => {
    await syncProducts(w.rt, "schedule"); // no folders synced yet
    const unlinked = (await w.rt.db.select().from(products).where(eq(products.categoryId, null as never))).length;
    expect(unlinked).toBe(0);
    expect((await w.rt.db.select().from(categories)).length).toBe(w.mock.dataset.folders.length);
  });
});

describe("incremental sync", () => {
  beforeEach(async () => {
    await autoConfigure(w.rt);
    await syncFolders(w.rt, "manual");
    await syncProducts(w.rt, "manual", "full");
    await syncStock(w.rt, "manual", "full");
  });

  it("picks up a price change and leaves every other row alone", async () => {
    const target = w.mock.dataset.products[4]!;
    w.mock.touchProduct(target.id, { priceUzs: 99_900 });
    await syncProducts(w.rt, "schedule");
    const [row] = await w.rt.db.select().from(products).where(eq(products.msId, target.id));
    expect(row!.price).toBe(99_900);
    const last = (await w.rt.db.select().from(syncRuns).where(eq(syncRuns.kind, "products"))).at(-1)!;
    expect(last.counts.updated).toBe(1);
  });

  it("marks genuinely new products with first_seen_at, so 'new arrivals' starts empty and fills honestly", async () => {
    const src = w.mock.dataset.products[0]!;
    w.mock.dataset.products.push({ ...src, id: "d4a4a4a4-0000-4000-8000-000000000001", name: "Yangi mahsulot", code: "NEW1", imageIds: [], updated: new Date() });
    await syncProducts(w.rt, "schedule");
    const [row] = await w.rt.db.select().from(products).where(eq(products.msId, "d4a4a4a4-0000-4000-8000-000000000001"));
    expect(row!.firstSeenAt).not.toBeNull();
  });

  it("reflects stock changes, and the full pass zeroes what the report no longer mentions", async () => {
    const target = w.mock.dataset.products.find((p) => !p.archived && w.mock.stockOf(p).free > 0)!;
    w.mock.touchProduct(target.id, { stock: 0 });
    await syncStock(w.rt, "schedule", "changed");
    let [row] = await w.rt.db.select().from(products).where(eq(products.msId, target.id));
    expect(row!.availableQty).toBe(0);

    w.mock.touchProduct(target.id, { stock: 17 });
    await syncStock(w.rt, "schedule", "changed");
    [row] = await w.rt.db.select().from(products).where(eq(products.msId, target.id));
    expect(row!.availableQty).toBe(17);

    // Stock vanishes without a delta (the report just stops listing it): only the full pass can notice.
    w.mock.dataset.products.find((p) => p.id === target.id)!.stock = {};
    await syncStock(w.rt, "schedule", "full");
    [row] = await w.rt.db.select().from(products).where(eq(products.msId, target.id));
    expect(row!.availableQty).toBe(0);
  });

  it("hides products deleted in MoySklad via the daily reconcile", async () => {
    const victim = w.mock.dataset.products.find((p) => !p.archived)!;
    w.mock.dataset.products = w.mock.dataset.products.filter((p) => p.id !== victim.id);
    await reconcileProducts(w.rt, "schedule");
    const [row] = await w.rt.db.select().from(products).where(eq(products.msId, victim.id));
    expect(row!.archived).toBe(true);
  });

  it("survives the timezone switch: with a UTC-reading server and a matching setting nothing is missed", async () => {
    w.mock.config.filterTimezoneOffsetHours = 0;
    await saveSettings(w.rt, { filterTimezoneOffsetHours: 0 });
    const target = w.mock.dataset.products[7]!;
    w.mock.touchProduct(target.id, { priceUzs: 5_550 });
    await syncProducts(w.rt, "schedule");
    const [row] = await w.rt.db.select().from(products).where(eq(products.msId, target.id));
    expect(row!.price).toBe(5_550);
  });
});

describe("webhooks are hints, not data", () => {
  beforeEach(async () => {
    await autoConfigure(w.rt);
    await syncFolders(w.rt, "manual");
    await syncProducts(w.rt, "manual", "full");
  });

  it("deduplicates retries on requestId and re-fetches the entity instead of trusting the payload", async () => {
    const target = w.mock.dataset.products[2]!;
    w.mock.touchProduct(target.id, { priceUzs: 31_000 });
    const body = { events: [{ meta: { type: "product", href: `${w.mock.config.publicUrl}/api/remap/1.2/entity/product/${target.id}` }, action: "UPDATE", accountId: IDS.account }] };
    const first = await recordWebhook(w.rt, "req-1", body, IDS.account);
    const retry = await recordWebhook(w.rt, "req-1", body, IDS.account);
    expect(first.accepted).toBe(1);
    expect(retry.accepted).toBe(0);
    await processWebhookEvents(w.rt, "webhook");
    const [row] = await w.rt.db.select().from(products).where(eq(products.msId, target.id));
    expect(row!.price).toBe(31_000);
    const events = await w.rt.db.select().from(webhookEvents);
    expect(events.every((e) => e.status === "processed")).toBe(true);
  });

  it("ignores events for another account and garbage bodies", async () => {
    const body = { events: [{ meta: { type: "product", href: "http://x/entity/product/1" }, action: "UPDATE", accountId: "someone-else" }] };
    expect((await recordWebhook(w.rt, "req-2", body, IDS.account)).accepted).toBe(0);
    expect((await recordWebhook(w.rt, "req-3", { hello: "world" }, IDS.account)).accepted).toBe(0);
  });

  it("a forged payload cannot write data: a poisoned price in the body is ignored", async () => {
    const target = w.mock.dataset.products[3]!;
    const before = target.priceMinor / 100;
    const body = { events: [{ meta: { type: "product", href: `${w.mock.config.publicUrl}/api/remap/1.2/entity/product/${target.id}` }, action: "UPDATE", accountId: IDS.account, price: 1 }] };
    await recordWebhook(w.rt, "req-4", body, IDS.account);
    await processWebhookEvents(w.rt, "webhook");
    const [row] = await w.rt.db.select().from(products).where(eq(products.msId, target.id));
    expect(row!.price).toBe(before);
  });
});

describe("settings", () => {
  it("round-trips and fills defaults", async () => {
    const s = await saveSettings(w.rt, { minimumOrderAmount: 50_000 });
    expect(s.minimumOrderAmount).toBe(50_000);
    expect((await loadSettings(w.rt)).reserveOnCreateWeb).toBe(false);
  });
});
