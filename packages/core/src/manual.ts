import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  brands,
  categories,
  categoryI18n,
  eq,
  inArray,
  ne,
  or,
  orderItems,
  orders,
  productImages,
  productOverlays,
  products,
  sql,
  type Db,
} from "@shop/db";
import {
  LOCAL_ORDER_STATUS_INFO,
  normalizeSearch,
  productSlug,
  slugify,
  type AdminProductDetail,
  type LocalOrderStatus,
  type ManualCategoryInput,
  type ManualProductInput,
  type ProductQuickEdit,
} from "@shop/shared";
import { clearCatalogCache } from "./catalog";
import { mediaUrl, processImage } from "./media";
import { queueNotification } from "./notify";
import type { Runtime } from "./runtime";
import { loadSettings } from "./settings";
import { qtyStepFor } from "./sync/catalog";
import { revalidateWeb } from "./sync/common";
import { texts } from "./texts";

/**
 * Hand-managed catalogue: products and categories the owner creates in the admin (source = 'manual').
 * MoySklad-owned rows are never edited here (only hidden), and sync never touches manual rows.
 */

export class CatalogEditError extends Error {
  constructor(
    readonly code: "not_found" | "managed_by_moysklad" | "too_many_images" | "bad_image_order" | "bad_parent" | "not_local_order" | "name_required",
    readonly status: number,
    message: string = code,
  ) {
    super(message);
    this.name = "CatalogEditError";
  }
}

type Rt = Pick<Runtime, "db" | "env" | "log">;

/** Every catalogue write ends here: the Mini App reads fresh data at once, and the SSR site's cached pages are expired right away. */
async function changed(rt: Rt): Promise<void> {
  clearCatalogCache();
  await revalidateWeb(rt, ["catalog"], { immediate: true });
}

async function productRow(db: Db, id: string) {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!row) throw new CatalogEditError("not_found", 404);
  return row;
}

async function manualProduct(db: Db, id: string) {
  const row = await productRow(db, id);
  if (row.source !== "manual") throw new CatalogEditError("managed_by_moysklad", 409, "This product comes from MoySklad: edit it there.");
  return row;
}

/** Reuses a brand with the same name (any letter case), otherwise creates it with a free slug. */
export async function ensureBrand(db: Db, name: string): Promise<{ id: string; name: string } | null> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const [found] = await db.select({ id: brands.id, name: brands.name }).from(brands).where(sql`lower(${brands.name}) = lower(${clean})`).limit(1);
  if (found) return found;
  const base = slugify(clean);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [created] = await db.insert(brands).values({ name: clean, slug }).onConflictDoNothing().returning({ id: brands.id, name: brands.name });
    if (created) return created;
    const [raced] = await db.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.name, clean)).limit(1);
    if (raced) return raced;
  }
  throw new Error("could not allocate a brand slug");
}

async function assertCategory(db: Db, categoryId: string | null): Promise<void> {
  if (!categoryId) return;
  const [c] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!c) throw new CatalogEditError("not_found", 422, "category not found");
}

async function setHidden(db: Db, productId: string, hidden: boolean): Promise<void> {
  await db.insert(productOverlays).values({ productId, hidden }).onConflictDoUpdate({ target: productOverlays.productId, set: { hidden, updatedAt: new Date() } });
}

// ------------------------------------------------------------------------------------------------ products

export async function getAdminProduct(rt: Rt, id: string): Promise<AdminProductDetail> {
  const p = await productRow(rt.db, id);
  const settings = await loadSettings(rt);
  const [brand] = p.brandId ? await rt.db.select({ name: brands.name }).from(brands).where(eq(brands.id, p.brandId)).limit(1) : [];
  const [overlay] = await rt.db.select({ hidden: productOverlays.hidden }).from(productOverlays).where(eq(productOverlays.productId, id)).limit(1);
  const images = await rt.db.select().from(productImages).where(eq(productImages.productId, id)).orderBy(asc(productImages.position));
  return {
    id: p.id,
    source: p.source === "manual" ? "manual" : "moysklad",
    slug: p.slug,
    name: p.name,
    nameRu: p.nameRu,
    article: p.article,
    barcodes: p.barcodes,
    description: p.description,
    descriptionRu: p.descriptionRu,
    categoryId: p.categoryId,
    brand: brand?.name ?? "",
    uom: p.uom ?? "",
    qtyStep: p.qtyStep,
    packSize: p.packSize,
    price: p.price,
    oldPrice: p.oldPrice,
    availableQty: p.availableQty,
    hidden: overlay?.hidden ?? false,
    archived: p.archived,
    images: images.map((i) => ({
      id: i.id,
      position: i.position,
      small: i.storageKey ? mediaUrl(i.storageKey, "small") : "",
      medium: i.storageKey ? mediaUrl(i.storageKey, "medium") : "",
      large: i.storageKey ? mediaUrl(i.storageKey, "large") : "",
      width: i.width,
      height: i.height,
      status: i.status,
    })),
    maxImages: settings.maxImagesPerProduct,
  };
}

async function productValues(rt: Rt, input: ManualProductInput, msId: string) {
  const settings = await loadSettings(rt);
  await assertCategory(rt.db, input.categoryId);
  const brand = await ensureBrand(rt.db, input.brand);
  const uom = input.uom.trim() || null;
  return {
    slug: productSlug(input.name, msId),
    name: input.name,
    nameRu: input.nameRu,
    // Both names: a shopper on the Russian site searches in Russian, one on the Uzbek site in Uzbek.
    nameSearch: normalizeSearch(`${input.name} ${input.nameRu} ${brand?.name ?? ""}`),
    article: input.article,
    barcodes: [...new Set(input.barcodes)],
    description: input.description,
    descriptionRu: input.descriptionRu,
    categoryId: input.categoryId,
    brandId: brand?.id ?? null,
    uom,
    qtyStep: input.qtyStep ?? qtyStepFor(uom, settings),
    packSize: input.packSize,
    price: input.price,
    // A crossed-out price that is not higher than the price would be a fake discount: never stored.
    oldPrice: input.oldPrice && input.oldPrice > input.price ? input.oldPrice : null,
    availableQty: input.availableQty,
    syncedAt: new Date(),
  };
}

export async function createManualProduct(rt: Rt, input: ManualProductInput): Promise<string> {
  // A manual product still gets a UUID in ms_id: the slug's short id and the "renamed product" redirect rely on it.
  const msId = randomUUID();
  const values = await productValues(rt, input, msId);
  const id = await rt.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({ ...values, msId, source: "manual", msType: "product", archived: false, firstSeenAt: new Date(), contentHash: "" })
      .returning({ id: products.id });
    await setHidden(tx as unknown as Db, row!.id, input.hidden);
    return row!.id;
  });
  await changed(rt);
  return id;
}

export async function updateManualProduct(rt: Rt, id: string, input: ManualProductInput): Promise<void> {
  const current = await manualProduct(rt.db, id);
  const values = await productValues(rt, input, current.msId);
  await rt.db.transaction(async (tx) => {
    await tx.update(products).set(values).where(eq(products.id, id));
    await setHidden(tx as unknown as Db, id, input.hidden);
  });
  await changed(rt);
}

/** Inline edits from the list. A MoySklad product accepts only `hidden`; its price and stock belong to MoySklad. */
export async function quickEditProduct(rt: Rt, id: string, edit: ProductQuickEdit): Promise<void> {
  const row = await productRow(rt.db, id);
  const touchesData = edit.price !== undefined || edit.availableQty !== undefined;
  if (touchesData && row.source !== "manual") throw new CatalogEditError("managed_by_moysklad", 409, "Price and stock of a MoySklad product are changed in MoySklad.");
  if (touchesData) {
    const price = edit.price ?? row.price;
    await rt.db
      .update(products)
      .set({
        ...(edit.price !== undefined ? { price: edit.price, oldPrice: row.oldPrice && row.oldPrice > price ? row.oldPrice : null } : {}),
        ...(edit.availableQty !== undefined ? { availableQty: edit.availableQty } : {}),
        syncedAt: new Date(),
      })
      .where(eq(products.id, id));
  }
  if (edit.hidden !== undefined) await setHidden(rt.db, id, edit.hidden);
  await changed(rt);
}

/** Removes a manual product. Past orders keep their own snapshot of name, article and price. */
export async function deleteManualProduct(rt: Rt, id: string): Promise<void> {
  await manualProduct(rt.db, id);
  await rt.db.delete(products).where(eq(products.id, id));
  await changed(rt);
}

// ------------------------------------------------------------------------------------------------ product photos

export async function addProductImage(rt: Rt, productId: string, bytes: Buffer): Promise<AdminProductDetail> {
  await manualProduct(rt.db, productId);
  const settings = await loadSettings(rt);
  const existing = await rt.db.select().from(productImages).where(eq(productImages.productId, productId)).orderBy(asc(productImages.position));
  if (existing.length >= settings.maxImagesPerProduct) throw new CatalogEditError("too_many_images", 422, `At most ${settings.maxImagesPerProduct} photos per product.`);

  const done = await processImage(rt.env.MEDIA_DIR, bytes, { square: true });
  // The same file uploaded twice is one photo, not two.
  if (!existing.some((i) => i.storageKey === done.storageKey)) {
    await rt.db.insert(productImages).values({
      productId,
      msImageId: `upload-${randomUUID()}`,
      position: existing.length === 0 ? 0 : Math.max(...existing.map((i) => i.position)) + 1,
      filename: "",
      size: bytes.length,
      downloadHref: "",
      storageKey: done.storageKey,
      width: done.width,
      height: done.height,
      status: "ready",
    });
    await changed(rt);
  }
  return getAdminProduct(rt, productId);
}

export async function deleteProductImage(rt: Rt, productId: string, imageId: string): Promise<AdminProductDetail> {
  await manualProduct(rt.db, productId);
  const removed = await rt.db.delete(productImages).where(and(eq(productImages.id, imageId), eq(productImages.productId, productId))).returning({ id: productImages.id });
  if (removed.length === 0) throw new CatalogEditError("not_found", 404);
  const rest = await rt.db.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, productId)).orderBy(asc(productImages.position));
  await renumber(rt.db, rest.map((r) => r.id));
  await changed(rt);
  return getAdminProduct(rt, productId);
}

/** `ids` is the full new order; the first one is the photo on the product card. */
export async function reorderProductImages(rt: Rt, productId: string, ids: string[]): Promise<AdminProductDetail> {
  await manualProduct(rt.db, productId);
  const rows = await rt.db.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, productId));
  const have = new Set(rows.map((r) => r.id));
  if (ids.length !== have.size || new Set(ids).size !== ids.length || !ids.every((i) => have.has(i))) throw new CatalogEditError("bad_image_order", 422);
  await renumber(rt.db, ids);
  await changed(rt);
  return getAdminProduct(rt, productId);
}

async function renumber(db: Db, ids: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [position, id] of ids.entries()) await tx.update(productImages).set({ position }).where(eq(productImages.id, id));
  });
}

// ------------------------------------------------------------------------------------------------ categories

export interface AdminCategoryRow {
  id: string;
  slug: string;
  name: string;
  source: string;
  parent_id: string | null;
  path_name: string;
  sort_order: number;
  archived: boolean;
  uz: string | null;
  ru: string | null;
  products: number;
  image_url: string | null;
}

export async function listAdminCategories(rt: Pick<Runtime, "db">): Promise<AdminCategoryRow[]> {
  const rows = (
    await rt.db.execute(sql`SELECT c.id, c.slug, c.name, c.source, c.parent_id, c.path_name, c.sort_order, c.archived,
      (SELECT name FROM category_i18n WHERE category_id = c.id AND locale = 'uz') AS uz,
      (SELECT name FROM category_i18n WHERE category_id = c.id AND locale = 'ru') AS ru,
      (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.archived = false) AS products, c.image_key
      FROM categories c ORDER BY c.sort_order, c.name`)
  ).rows as unknown as (Omit<AdminCategoryRow, "image_url"> & { image_key: string | null })[];
  return rows.map(({ image_key, ...r }) => ({ ...r, image_url: image_key ? mediaUrl(image_key, "small") : null }));
}

/** Sets (bytes) or removes (null) the owner's own picture for a category. Works for MoySklad categories too: the picture is ours. */
export async function setCategoryImage(rt: Rt, id: string, bytes: Buffer | null): Promise<{ imageUrl: string | null }> {
  const [row] = await rt.db.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).limit(1);
  if (!row) throw new CatalogEditError("not_found", 404);
  const key = bytes ? (await processImage(rt.env.MEDIA_DIR, bytes)).storageKey : null;
  await rt.db.update(categories).set({ imageKey: key }).where(eq(categories.id, id));
  await changed(rt);
  return { imageUrl: key ? mediaUrl(key, "small") : null };
}

async function freeCategorySlug(db: Db, name: string, exceptId?: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set(
    (await db.select({ slug: categories.slug, id: categories.id }).from(categories).where(sql`${categories.slug} = ${base} OR ${categories.slug} LIKE ${`${base}-%`}`))
      .filter((r) => r.id !== exceptId)
      .map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

async function writeCategoryNames(db: Db, id: string, input: Pick<ManualCategoryInput, "nameUz" | "nameRu">): Promise<void> {
  for (const locale of ["uz", "ru"] as const) {
    const name = (locale === "uz" ? input.nameUz : input.nameRu).trim();
    if (!name) await db.delete(categoryI18n).where(and(eq(categoryI18n.categoryId, id), eq(categoryI18n.locale, locale)));
    else await db.insert(categoryI18n).values({ categoryId: id, locale, name }).onConflictDoUpdate({ target: [categoryI18n.categoryId, categoryI18n.locale], set: { name } });
  }
}

async function pathName(db: Db, parentId: string | null): Promise<string> {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let cur = parentId; cur && !seen.has(cur); ) {
    seen.add(cur);
    const [row] = await db.select({ name: categories.name, parentId: categories.parentId }).from(categories).where(eq(categories.id, cur)).limit(1);
    if (!row) break;
    names.unshift(row.name);
    cur = row.parentId;
  }
  return names.join("/");
}

/** A parent must exist and must not be the category itself or one of its descendants (that would make a loop). */
async function assertParent(db: Db, id: string | null, parentId: string | null): Promise<void> {
  if (!parentId) return;
  const [parent] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, parentId)).limit(1);
  if (!parent) throw new CatalogEditError("bad_parent", 422, "parent category not found");
  if (!id) return;
  for (let cur: string | null = parentId; cur; ) {
    if (cur === id) throw new CatalogEditError("bad_parent", 422, "a category cannot be inside itself");
    const [row] = await db.select({ parentId: categories.parentId }).from(categories).where(eq(categories.id, cur)).limit(1);
    cur = row?.parentId ?? null;
  }
}

function manualCategoryName(input: ManualCategoryInput): string {
  const name = input.nameUz || input.nameRu;
  if (name.length < 2) throw new CatalogEditError("name_required", 422, "Name the category in at least one language.");
  return name;
}

export async function createManualCategory(rt: Rt, input: ManualCategoryInput): Promise<string> {
  const name = manualCategoryName(input);
  await assertParent(rt.db, null, input.parentId);
  const id = await rt.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    const [row] = await tx
      .insert(categories)
      .values({ msId: randomUUID(), source: "manual", name, slug: await freeCategorySlug(db, name), parentId: input.parentId, pathName: await pathName(db, input.parentId), sortOrder: input.sortOrder })
      .returning({ id: categories.id });
    await writeCategoryNames(db, row!.id, input);
    return row!.id;
  });
  await changed(rt);
  return id;
}

/**
 * Manual category: names, parent and order. MoySklad category: only the uz/ru display names and the order;
 * its own name and place in the tree come from MoySklad.
 */
export async function updateCategory(rt: Rt, id: string, input: ManualCategoryInput): Promise<void> {
  const [row] = await rt.db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!row) throw new CatalogEditError("not_found", 404);
  await rt.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    if (row.source === "manual") {
      const name = manualCategoryName(input);
      await assertParent(db, id, input.parentId);
      await tx
        .update(categories)
        .set({
          name,
          slug: name === row.name ? row.slug : await freeCategorySlug(db, name, id),
          parentId: input.parentId,
          pathName: await pathName(db, input.parentId),
          sortOrder: input.sortOrder,
          syncedAt: new Date(),
        })
        .where(eq(categories.id, id));
    } else {
      await tx.update(categories).set({ sortOrder: input.sortOrder }).where(eq(categories.id, id));
    }
    await writeCategoryNames(db, id, input);
  });
  await changed(rt);
}

/** Deletes a manual category. Its sub-categories move up one level; its products stay, without a category. */
export async function deleteManualCategory(rt: Rt, id: string): Promise<{ movedProducts: number; movedChildren: number }> {
  const [row] = await rt.db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!row) throw new CatalogEditError("not_found", 404);
  if (row.source !== "manual") throw new CatalogEditError("managed_by_moysklad", 409, "This category comes from MoySklad.");
  const result = await rt.db.transaction(async (tx) => {
    const children = await tx.update(categories).set({ parentId: row.parentId }).where(eq(categories.parentId, id)).returning({ id: categories.id });
    const prods = await tx.update(products).set({ categoryId: null }).where(eq(products.categoryId, id)).returning({ id: products.id });
    await tx.delete(categories).where(eq(categories.id, id));
    return { movedProducts: prods.length, movedChildren: children.length };
  });
  await changed(rt);
  return result;
}

// ------------------------------------------------------------------------------------------------ locally handled orders

/**
 * Status change for an order handled in our admin. Cancelling gives the units of manual products back to stock;
 * un-cancelling takes them again. The customer is told in their language (Telegram, when they ordered from the Mini App).
 */
export async function setLocalOrderStatus(rt: Runtime, orderId: string, status: LocalOrderStatus): Promise<void> {
  const [order] = await rt.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new CatalogEditError("not_found", 404);
  if (order.syncStatus !== "local") throw new CatalogEditError("not_local_order", 409, "This order is handled in MoySklad.");
  if (order.localStatus === status) return;

  const wasCancelled = order.localStatus === "cancelled";
  const nowCancelled = status === "cancelled";
  await rt.db.transaction(async (tx) => {
    if (wasCancelled !== nowCancelled) {
      const items = await tx.select({ productId: orderItems.productId, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, orderId));
      for (const i of items) {
        if (!i.productId) continue;
        const delta = nowCancelled ? i.quantity : -i.quantity;
        await tx.execute(sql`UPDATE products SET available_qty = available_qty + ${delta} WHERE id = ${i.productId} AND source = 'manual'`);
      }
    }
    await tx.update(orders).set({ localStatus: status, updatedAt: new Date() }).where(eq(orders.id, orderId));
  });
  if (wasCancelled !== nowCancelled) await changed(rt);

  const lang = order.language === "ru" ? "ru" : "uz";
  await queueNotification(rt, { kind: "order_status", chatId: order.telegramId, text: texts.orderStatus(lang, order.number, LOCAL_ORDER_STATUS_INFO[status][lang]) });
}

// ------------------------------------------------------------------------------------------------ deleting cancelled orders

/** Database side of isCancelledOrder (@shop/shared); the statistics use the same rule (CANCELLED in stats.ts). */
export const cancelledOrderWhere = or(
  and(eq(orders.syncStatus, "local"), eq(orders.localStatus, "cancelled")),
  eq(orders.syncStatus, "cancelled"),
  and(ne(orders.syncStatus, "local"), eq(orders.msStateType, "Unsuccessful")),
)!;

/**
 * Removes cancelled orders for good (their lines go with them). Only cancelled ones: their stock already came back when they were
 * cancelled, so nothing else changes. The check is part of the DELETE itself, so an order un-cancelled a moment earlier stays.
 * With ids: those of them that are cancelled; without: every cancelled order. Returns the removed orders' numbers.
 * Nothing is sent to MoySklad (an order there stays there).
 */
export async function deleteCancelledOrders(rt: Pick<Runtime, "db">, ids?: string[]): Promise<string[]> {
  if (ids && ids.length === 0) return [];
  const where = ids ? and(inArray(orders.id, ids), cancelledOrderWhere) : cancelledOrderWhere;
  const gone = await rt.db.delete(orders).where(where).returning({ number: orders.number });
  return gone.map((o) => o.number);
}
