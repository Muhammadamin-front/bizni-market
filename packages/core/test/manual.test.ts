import { readdir } from "node:fs/promises";
import path from "node:path";
import { categories, eq, orders, productImages, products, stockLevels } from "@shop/db";
import { CheckoutInput, ManualCategoryInput, ManualProductInput } from "@shop/shared";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addProductImage,
  CatalogEditError,
  categoryTree,
  createManualCategory,
  createManualProduct,
  createOrder,
  deleteManualCategory,
  deleteManualProduct,
  deleteProductImage,
  fullSync,
  getProduct,
  ImageError,
  isDemoSource,
  listProducts,
  OrderError,
  quickEditProduct,
  reconcileProducts,
  reorderProductImages,
  setLocalOrderStatus,
  syncFolders,
  syncImages,
  syncStock,
  updateManualProduct,
  type CreateOrderContext,
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

const product = (over: Partial<Record<keyof ManualProductInput, unknown>> = {}) =>
  ManualProductInput.parse({ name: "Daftar 48 varaq katak", price: 4500, availableQty: 20, article: "DF-48", brand: "Hamkor", ...over });
const category = (over: Partial<Record<keyof ManualCategoryInput, unknown>> = {}) => ManualCategoryInput.parse({ nameUz: "Daftarlar", nameRu: "Тетради", ...over });

let seq = 0;
const ctx = (over: Partial<CreateOrderContext> = {}): CreateOrderContext => ({
  channel: "web",
  customerId: null,
  telegramId: null,
  ip: `10.1.0.${(seq % 200) + 1}`,
  idempotencyKey: `manual-${Date.now()}-${seq++}`,
  ...over,
});
const checkout = (items: { productId: string; quantity: number }[]) =>
  CheckoutInput.parse({ name: "Ali Valiyev", phone: `90 123 ${String(10 + (seq % 80)).padStart(2, "0")} 67`, deliveryMethod: "pickup", items });

const photo = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } })
    .composite([{ input: { create: { width: Math.round(w / 3), height: Math.round(h / 2), channels: 3, background: "#cc2233" } }, left: Math.round(w / 3), top: Math.round(h / 4) }])
    .jpeg()
    .toBuffer();

describe("manual catalogue", () => {
  it("a product typed in the admin is on the storefront at once: listed, searchable, in its category, with its brand", async () => {
    const cat = await createManualCategory(w.rt, category());
    const id = await createManualProduct(w.rt, product({ categoryId: cat }));
    const [row] = await w.rt.db.select().from(products).where(eq(products.id, id));
    expect(row!.source).toBe("manual");
    expect(row!.firstSeenAt).not.toBeNull(); // shows up under "new arrivals"
    expect(row!.slug).toMatch(/^daftar-48-varaq-katak-[0-9a-f]{8}$/);

    const page = await listProducts(w.rt, { q: "дафтар", brand: [], inStock: false, sort: "popular", page: 1, pageSize: 10, locale: "uz" });
    expect(page.items.map((p) => p.id)).toEqual([id]); // Cyrillic query finds the Latin name
    expect(page.items[0]).toMatchObject({ brand: "Hamkor", price: 4500, stockStatus: "in", freeStock: 20 });

    const tree = await categoryTree(w.rt, "ru");
    expect(tree.tree.map((c) => [c.name, c.productCount])).toEqual([["Тетради", 1]]);
    const found = await getProduct(w.rt, row!.slug, "uz");
    expect(found && "product" in found ? found.product.categoryPath : null).toEqual([{ slug: "daftarlar", name: "Daftarlar" }]);
  });

  it("price 0 or hidden keeps a product off the storefront; a rename keeps the old link working", async () => {
    const id = await createManualProduct(w.rt, product({ price: 0 }));
    const empty = await listProducts(w.rt, { brand: [], inStock: false, sort: "popular", page: 1, pageSize: 10, locale: "uz" });
    expect(empty.total).toBe(0);
    await quickEditProduct(w.rt, id, { price: 5000 });
    const [before] = await w.rt.db.select().from(products).where(eq(products.id, id));
    await updateManualProduct(w.rt, id, product({ name: "Daftar 96 varaq", price: 7000, oldPrice: 9000 }));
    const [after] = await w.rt.db.select().from(products).where(eq(products.id, id));
    expect(after!.slug).not.toBe(before!.slug);
    expect(await getProduct(w.rt, before!.slug, "uz")).toEqual({ redirectTo: after!.slug });
    expect(after!.oldPrice).toBe(9000);
    await quickEditProduct(w.rt, id, { hidden: true });
    expect(await getProduct(w.rt, after!.slug, "uz")).toBeNull();
  });

  it("without a MoySklad token the shop is the owner's real catalogue, never labelled a demo", () => {
    expect(isDemoSource({ MOYSKLAD_TOKEN: "", MOYSKLAD_BASE_URL: "http://localhost:4010/api/remap/1.2" })).toBe(false);
    expect(isDemoSource({ MOYSKLAD_TOKEN: "x", MOYSKLAD_BASE_URL: "http://localhost:4010/api/remap/1.2" })).toBe(true);
    expect(isDemoSource({ MOYSKLAD_TOKEN: "x", MOYSKLAD_BASE_URL: "https://api.moysklad.ru/api/remap/1.2" })).toBe(false);
  });

  it("refuses a fake discount and reuses brands regardless of letter case", async () => {
    expect(() => product({ price: 5000, oldPrice: 5000 })).toThrow(/old_price_not_higher/);
    const a = await createManualProduct(w.rt, product({ brand: "Erich Krause" }));
    const b = await createManualProduct(w.rt, product({ name: "Ruchka", brand: "erich krause" }));
    const rows = await w.rt.db.select({ brandId: products.brandId }).from(products);
    expect(new Set(rows.map((r) => r.brandId)).size).toBe(1);
    expect(a).not.toBe(b);
  });

  it("MoySklad products stay read-only: only hiding is allowed", async () => {
    await fullSync(w.rt, "manual");
    const [ms] = await w.rt.db.select().from(products).where(eq(products.source, "moysklad")).limit(1);
    await expect(updateManualProduct(w.rt, ms!.id, product())).rejects.toMatchObject({ code: "managed_by_moysklad", status: 409 });
    await expect(quickEditProduct(w.rt, ms!.id, { price: 1 })).rejects.toBeInstanceOf(CatalogEditError);
    await expect(deleteManualProduct(w.rt, ms!.id)).rejects.toMatchObject({ code: "managed_by_moysklad" });
    await expect(addProductImage(w.rt, ms!.id, await photo(600, 600))).rejects.toMatchObject({ code: "managed_by_moysklad" });
    await quickEditProduct(w.rt, ms!.id, { hidden: true });
  });
});

describe("photos", () => {
  it("every upload becomes a 1:1 square in three sizes; order, delete and the per-product cap work", async () => {
    const id = await createManualProduct(w.rt, product());
    let detail = await addProductImage(w.rt, id, await photo(600, 1800)); // tall phone photo
    detail = await addProductImage(w.rt, id, await photo(2400, 800)); // wide scan
    detail = await addProductImage(w.rt, id, await photo(2400, 800)); // the same file again: not a second photo
    expect(detail.images).toHaveLength(2);
    expect(detail.images.map((i) => [i.width, i.height])).toEqual([[600, 1800], [2400, 800]]);
    for (const img of detail.images) {
      for (const url of [img.small, img.medium, img.large]) {
        const file = path.join(w.mediaDir, url.replace(/^\/media\//, ""));
        const meta = await sharp(file).metadata();
        expect(meta.width).toBe(meta.height); // square, so every card and the gallery line up
        expect(meta.hasAlpha).toBe(false);
      }
    }

    const [first, second] = detail.images;
    detail = await reorderProductImages(w.rt, id, [second!.id, first!.id]);
    expect(detail.images[0]!.id).toBe(second!.id);
    await expect(reorderProductImages(w.rt, id, [second!.id])).rejects.toMatchObject({ code: "bad_image_order" });
    const card = (await listProducts(w.rt, { brand: [], inStock: false, sort: "popular", page: 1, pageSize: 5, locale: "uz" })).items[0]!;
    expect(card.imageUrl).toBe(second!.medium); // the first photo is the card photo

    detail = await deleteProductImage(w.rt, id, second!.id);
    expect(detail.images.map((i) => [i.id, i.position])).toEqual([[first!.id, 0]]);

    for (let i = 0; i < 4; i++) await addProductImage(w.rt, id, await photo(700 + i, 700));
    await expect(addProductImage(w.rt, id, await photo(900, 900))).rejects.toMatchObject({ code: "too_many_images" });
  });

  it("refuses what is not a usable picture, with a reason the admin can show", async () => {
    const id = await createManualProduct(w.rt, product());
    await expect(addProductImage(w.rt, id, Buffer.from("not an image".repeat(40)))).rejects.toMatchObject({ code: "unsupported" });
    await expect(addProductImage(w.rt, id, await photo(40, 40))).rejects.toMatchObject({ code: "too_small" });
    await expect(addProductImage(w.rt, id, Buffer.alloc(16 * 1024 * 1024))).rejects.toBeInstanceOf(ImageError);
    expect(await w.rt.db.select().from(productImages)).toHaveLength(0);
  });
});

describe("categories", () => {
  it("nests, refuses loops, and deleting one keeps its products and sub-categories", async () => {
    const root = await createManualCategory(w.rt, category({ nameUz: "Kanselyariya", nameRu: "Канцелярия" }));
    const child = await createManualCategory(w.rt, category({ parentId: root }));
    const grandchild = await createManualCategory(w.rt, category({ nameUz: "Bloknotlar", nameRu: "Блокноты", parentId: child }));
    await expect(createManualCategory(w.rt, category({ nameUz: "Kanselyariya" }))).resolves.toBeTruthy(); // same name, free slug
    const { updateCategory } = await import("../src");
    await expect(updateCategory(w.rt, root, category({ nameUz: "Kanselyariya", parentId: grandchild }))).rejects.toMatchObject({ code: "bad_parent" });

    const pid = await createManualProduct(w.rt, product({ categoryId: child }));
    expect(await deleteManualCategory(w.rt, child)).toEqual({ movedProducts: 1, movedChildren: 1 });
    const [g] = await w.rt.db.select().from(categories).where(eq(categories.id, grandchild));
    expect(g!.parentId).toBe(root);
    const [p] = await w.rt.db.select().from(products).where(eq(products.id, pid));
    expect(p!.categoryId).toBeNull();
  });
});

describe("MoySklad connected later", () => {
  it("syncing, the nightly reconcile and the full stock pass leave manual products and categories alone", async () => {
    const cat = await createManualCategory(w.rt, category());
    const id = await createManualProduct(w.rt, product({ categoryId: cat, availableQty: 7 }));
    await addProductImage(w.rt, id, await photo(800, 800));

    await fullSync(w.rt, "manual");
    await syncFolders(w.rt, "manual");
    await syncStock(w.rt, "manual", "full");
    await reconcileProducts(w.rt, "manual");
    await syncImages(w.rt, "manual");

    const [p] = await w.rt.db.select().from(products).where(eq(products.id, id));
    expect(p).toMatchObject({ archived: false, availableQty: 7, categoryId: cat, source: "manual" });
    expect(await w.rt.db.select().from(stockLevels).where(eq(stockLevels.productId, id))).toHaveLength(0);
    const [c] = await w.rt.db.select().from(categories).where(eq(categories.id, cat));
    expect(c!.archived).toBe(false);
    const [img] = await w.rt.db.select().from(productImages).where(eq(productImages.productId, id));
    expect(img!.status).toBe("ready");
    expect((await readdir(path.join(w.mediaDir, img!.storageKey!.slice(0, 2)))).length).toBeGreaterThanOrEqual(3);
    // and the MoySklad catalogue arrived next to it
    expect((await w.rt.db.select().from(products).where(eq(products.source, "moysklad"))).length).toBeGreaterThan(0);
  });
});

describe("orders for manual products", () => {
  it("take stock atomically, are handled locally even with MoySklad connected, and cancelling gives the stock back", async () => {
    const id = await createManualProduct(w.rt, product({ availableQty: 3 }));
    const { order } = await createOrder(w.rt, checkout([{ productId: id, quantity: 2 }]), ctx());
    expect(order).toMatchObject({ syncStatus: "local", statusCode: "new" });
    const qty = async () => (await w.rt.db.select({ q: products.availableQty }).from(products).where(eq(products.id, id)))[0]!.q;
    expect(await qty()).toBe(1);
    await expect(createOrder(w.rt, checkout([{ productId: id, quantity: 2 }]), ctx())).rejects.toBeInstanceOf(OrderError);
    expect(await qty()).toBe(1); // the refused order took nothing

    await setLocalOrderStatus(w.rt, order.id, "confirmed");
    expect(await qty()).toBe(1);
    await setLocalOrderStatus(w.rt, order.id, "cancelled");
    expect(await qty()).toBe(3);
    await setLocalOrderStatus(w.rt, order.id, "cancelled"); // twice is still once
    expect(await qty()).toBe(3);
    await setLocalOrderStatus(w.rt, order.id, "new"); // un-cancel takes them again
    expect(await qty()).toBe(1);
    const [row] = await w.rt.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.localStatus).toBe("new");
    expect(w.mock.orders).toHaveLength(0);
  });

  it("refuses a status change on an order that lives in MoySklad", async () => {
    await fullSync(w.rt, "manual");
    const [ms] = (await w.rt.db.select().from(products).where(eq(products.source, "moysklad"))).filter((p) => p.price > 0 && p.availableQty >= 5 && p.qtyStep === 1);
    const { order } = await createOrder(w.rt, checkout([{ productId: ms!.id, quantity: 1 }]), ctx());
    expect(order.syncStatus).toBe("pending_sync");
    await expect(setLocalOrderStatus(w.rt, order.id, "done")).rejects.toMatchObject({ code: "not_local_order" });
  });
});
