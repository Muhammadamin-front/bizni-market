import { count, eq, featuredSlots, productOverlays, products } from "@shop/db";
import { CatalogQuery } from "@shop/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { brandList, categoryBySlug, categoryTree, clearCatalogCache, fullSync, getProduct, homePayload, listProducts, productsByIds, relatedProducts, saveSettings, sitemapEntries, suggest, syncImages } from "../src";
import { createWorld, type TestWorld } from "./helpers";

let w: TestWorld;
beforeAll(async () => {
  w = await createWorld();
  await fullSync(w.rt, "manual");
  // Photos for a few products only (keeps the suite fast); the rest stay imageless on purpose.
  await w.rt.db.execute(`DELETE FROM product_images WHERE id NOT IN (SELECT id FROM product_images ORDER BY id LIMIT 8)` as never);
  await syncImages(w.rt, "manual");
});
afterAll(async () => {
  await w.stop();
});
beforeEach(() => clearCatalogCache());

const q = (over: Record<string, unknown> = {}) => CatalogQuery.parse(over);

describe("listing", () => {
  it("shows only what a customer may buy: no archived products, no zero prices, no admin-hidden ones", async () => {
    const all = await listProducts(w.rt, q({ pageSize: 60 }));
    const [{ n }] = (await w.rt.db.execute(`SELECT count(*)::int AS n FROM products WHERE archived = false AND price > 0` as never)).rows as [{ n: number }];
    expect(all.total).toBe(n);

    const hidden = all.items[0]!;
    await w.rt.db.insert(productOverlays).values({ productId: hidden.id, hidden: true });
    const after = await listProducts(w.rt, q({ pageSize: 60 }));
    expect(after.total).toBe(n - 1);
    expect(after.items.some((i) => i.id === hidden.id)).toBe(false);
    await w.rt.db.delete(productOverlays);

    await w.rt.db.update(products).set({ price: 0 }).where(eq(products.id, hidden.id));
    expect((await listProducts(w.rt, q())).total).toBe(n - 1);
    await w.rt.db.update(products).set({ price: hidden.price }).where(eq(products.id, hidden.id));
  });

  it("pages without gaps or repeats, and reports price bounds for the filter", async () => {
    const seen = new Set<string>();
    let page = 1;
    for (;;) {
      const r = await listProducts(w.rt, q({ page, pageSize: 40, sort: "name" }));
      for (const i of r.items) {
        expect(seen.has(i.id)).toBe(false);
        seen.add(i.id);
      }
      if (page * 40 >= r.total) {
        expect(seen.size).toBe(r.total);
        expect(r.priceMax).toBeGreaterThan(r.priceMin);
        break;
      }
      page++;
    }
  });

  it("sorts by price and filters by range, stock and brand", async () => {
    const asc = (await listProducts(w.rt, q({ sort: "price_asc", pageSize: 60 }))).items.map((i) => i.price);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const desc = (await listProducts(w.rt, q({ sort: "price_desc", pageSize: 60 }))).items.map((i) => i.price);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));

    const ranged = await listProducts(w.rt, q({ priceMin: 10_000, priceMax: 20_000, pageSize: 60 }));
    expect(ranged.items.every((i) => i.price >= 10_000 && i.price <= 20_000)).toBe(true);
    expect(ranged.items.length).toBeGreaterThan(0);

    const instock = await listProducts(w.rt, q({ inStock: "1", pageSize: 60 }));
    expect(instock.items.every((i) => i.stockStatus !== "out")).toBe(true);

    const brands = await brandList(w.rt);
    const deli = brands.find((b) => b.name === "Deli")!;
    const byBrand = await listProducts(w.rt, q({ brand: deli.slug, pageSize: 60 }));
    expect(byBrand.total).toBe(deli.productCount);
    expect(byBrand.items.every((i) => i.brand === "Deli")).toBe(true);
  });

  it("includes subcategories when filtering by a parent category", async () => {
    const { tree } = await categoryTree(w.rt, "uz");
    const root = tree.find((n) => n.name === "Kanselyariya")!;
    expect(root.children.length).toBeGreaterThan(3);
    const sum = root.children.reduce((s, c) => s + c.productCount, 0);
    expect(root.productCount).toBe(sum);
    const all = await listProducts(w.rt, q({ category: root.slug, pageSize: 60 }));
    expect(all.total).toBe(root.productCount);
    const one = await listProducts(w.rt, q({ category: root.children[0]!.slug, pageSize: 60 }));
    expect(one.total).toBe(root.children[0]!.productCount);
  });

  it("gives a card everything the UI needs, and an image only where a photo was really downloaded", async () => {
    const all = [];
    for (let page = 1; page <= 6; page++) all.push(...(await listProducts(w.rt, q({ page, pageSize: 60, sort: "name" }))).items);
    const withImage = all.filter((i) => i.imageUrl);
    expect(withImage.length).toBeGreaterThan(0);
    expect(withImage[0]!.imageUrl).toMatch(/^\/media\/[0-9a-f]{2}\/[0-9a-f]{20}-400\.webp$/);
    expect(all.some((i) => i.imageUrl === null)).toBe(true);
    const c = all[0]!;
    expect(c).toMatchObject({ name: expect.any(String), slug: expect.stringMatching(/-[0-9a-f]{8}$/), price: expect.any(Number), qtyStep: expect.any(Number) });
    // cost fields must not exist anywhere on the public shape
    expect(JSON.stringify(c)).not.toMatch(/buy|cost|minPrice/i);
  });

  it("hides products without a photo when the owner asks for it", async () => {
    await saveSettings(w.rt, { requireImage: true });
    const r = await listProducts(w.rt, q({ pageSize: 60 }));
    expect(r.total).toBeGreaterThan(0);
    expect(r.items.every((i) => i.imageUrl !== null)).toBe(true);
    await saveSettings(w.rt, { requireImage: false });
  });
});

describe("search", () => {
  const names = async (term: string) => (await listProducts(w.rt, q({ q: term, pageSize: 60 }))).items.map((i) => i.id).sort();

  it("finds the same products in Latin, Cyrillic and other spellings", async () => {
    const latin = await names("shtrix korrektor");
    expect(latin.length).toBeGreaterThan(0);
    expect(await names("штрих корректор")).toEqual(latin);
    expect(await names("SHTRIKH korrektor")).toEqual(latin);
    expect(await names("ручка")).toEqual(await names("ruchka"));
  });

  it("matches every word, in any order", async () => {
    const a = await names("deli ruchka");
    const b = await names("ruchka deli");
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    expect((await listProducts(w.rt, q({ q: "deli ruchka", pageSize: 60 }))).items.every((i) => /deli/i.test(i.name) && /ruchka/i.test(i.name))).toBe(true);
  });

  it("puts an exact article first, and finds by barcode", async () => {
    const [p] = await w.rt.db.select().from(products).where(eq(products.archived, false)).limit(1);
    const byArticle = await listProducts(w.rt, q({ q: p!.article }));
    expect(byArticle.items[0]!.id).toBe(p!.id);
    const byBarcode = await listProducts(w.rt, q({ q: p!.barcodes[0]! }));
    expect(byBarcode.items.map((i) => i.id)).toContain(p!.id);
  });

  it("treats hostile input as plain text", async () => {
    const before = (await w.rt.db.select({ c: count() }).from(products))[0]!.c;
    for (const term of [`'; DROP TABLE products; --`, "%", "_", "\\", `" OR 1=1 --`, "a%b_c", "x".repeat(100)]) {
      const r = await listProducts(w.rt, q({ q: term }));
      expect(r.total).toBeGreaterThanOrEqual(0);
    }
    expect((await listProducts(w.rt, q({ q: "%" }))).total).toBe(0); // a percent sign is not a wildcard
    expect((await w.rt.db.select({ c: count() }).from(products))[0]!.c).toBe(before);
  });

  it("suggests products, categories and brands", async () => {
    const s = await suggest(w.rt, "ruch", "uz");
    expect(s.products.length).toBeGreaterThan(0);
    expect(s.categories.some((c) => /ruchka/i.test(c.name))).toBe(true);
    expect((await suggest(w.rt, "a", "uz")).products).toHaveLength(0); // too short to be useful
    const brand = await suggest(w.rt, "deli", "uz");
    expect(brand.brands.some((b) => b.name === "Deli")).toBe(true);
  });
});

describe("product page", () => {
  it("returns the detail with the category path and images, and redirects a renamed product's old link", async () => {
    const [p] = (await w.rt.db.execute(`SELECT pr.* FROM products pr JOIN product_images i ON i.product_id = pr.id WHERE i.status = 'ready' AND pr.archived = false AND pr.price > 0 LIMIT 1` as never)).rows as { id: string; slug: string; ms_id: string }[];
    const found = await getProduct(w.rt, p!.slug, "uz");
    expect(found && "product" in found).toBe(true);
    if (found && "product" in found) {
      expect(found.product.images.length).toBeGreaterThan(0);
      expect(found.product.images[0]!.large).toMatch(/-1000\.webp$/);
      expect(found.product.categoryPath.length).toBe(2);
      expect(found.product.description).toContain("demo");
    }
    const stale = `old-name-${p!.ms_id.replace(/-/g, "").slice(0, 8)}`;
    expect(await getProduct(w.rt, stale, "uz")).toEqual({ redirectTo: p!.slug });
    expect(await getProduct(w.rt, "nope-00000000", "uz")).toBeNull();
  });

  it("offers related products from the same category, never the product itself", async () => {
    const [p] = (await w.rt.db.select().from(products).where(eq(products.archived, false)).limit(1))!;
    const rel = await relatedProducts(w.rt, p!.id);
    expect(rel.length).toBeGreaterThan(0);
    expect(rel.some((r) => r.id === p!.id)).toBe(false);
  });

  it("resolves a list of ids in order and silently drops unavailable ones", async () => {
    const some = (await listProducts(w.rt, q({ pageSize: 3 }))).items.map((i) => i.id);
    const list = await productsByIds(w.rt, [some[2]!, "00000000-0000-4000-8000-000000000000", some[0]!]);
    expect(list.map((i) => i.id)).toEqual([some[2], some[0]]);
  });
});

describe("home page", () => {
  it("fills sections from real data only: offers from genuine old prices, 'new' and 'bestsellers' empty until they exist", async () => {
    const home = await homePayload(w.rt, "uz");
    expect(home.offers.length).toBeGreaterThan(0);
    expect(home.offers.every((p) => p.oldPrice !== null && p.oldPrice > p.price)).toBe(true);
    expect(home.newArrivals).toEqual([]);
    expect(home.bestsellers).toEqual([]);
    expect(home.featured).toEqual([]);
    expect(home.categories.length).toBe(2);
    expect(home.brands.length).toBeGreaterThan(5);
    expect(home.banners).toEqual([]);
  });

  it("lets the admin curate a slot, and curated products win over the automatic fallback", async () => {
    const [a, b] = (await listProducts(w.rt, q({ pageSize: 2 }))).items;
    await w.rt.db.insert(featuredSlots).values([{ slot: "featured", productId: a!.id, position: 1 }, { slot: "offers", productId: b!.id, position: 1 }]);
    const home = await homePayload(w.rt, "uz");
    expect(home.featured.map((p) => p.id)).toEqual([a!.id]);
    expect(home.offers.map((p) => p.id)).toEqual([b!.id]);
    await w.rt.db.delete(featuredSlots);
  });

  it("maps root categories to the two segments from settings", async () => {
    const { tree } = await categoryTree(w.rt, "uz");
    const kans = tree.find((n) => n.name === "Kanselyariya")!;
    await saveSettings(w.rt, { segmentRootCategories: { [kans.slug]: "stationery" } });
    clearCatalogCache();
    const after = (await categoryTree(w.rt, "uz")).tree.find((n) => n.slug === kans.slug)!;
    expect(after.segment).toBe("stationery");
    expect(after.children.every((c) => c.segment === "stationery")).toBe(true);
    const found = await categoryBySlug(w.rt, after.children[0]!.slug, "uz");
    expect(found?.path.map((p) => p.name)).toEqual(["Kanselyariya", after.children[0]!.name]);
  });

  it("lists everything public for the sitemap", async () => {
    const m = await sitemapEntries(w.rt);
    expect(m.products.length).toBe((await listProducts(w.rt, q({ pageSize: 1 }))).total);
    expect(m.categories.length).toBeGreaterThan(5);
  });
});
