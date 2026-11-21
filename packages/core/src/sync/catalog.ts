import { createHash } from "node:crypto";
import {
  and,
  brands,
  categories,
  eq,
  inArray,
  productImages,
  products,
  sql,
  type Db,
  type PgColumn,
} from "@shop/db";
import type { MappingConfig, MsFolder, MsProduct } from "@shop/moysklad";
import { normalizeSearch, productSlug, slugify, type IntegrationSettings } from "@shop/shared";
import { enqueueSync } from "../queues";
import type { Runtime } from "../runtime";
import { getState, loadSettings, setState } from "../settings";
import { revalidateWeb, withRun, type Counts, type Trigger } from "./common";

const ex = (c: PgColumn) => sql.raw(`excluded."${c.name}"`);
const chunk = <T>(arr: T[], n: number): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export function mappingFrom(s: IntegrationSettings): MappingConfig {
  return { priceTypeId: s.priceTypeId, oldPriceTypeId: s.oldPriceTypeId, brandAttributeId: s.brandAttributeId, timezoneOffsetHours: s.filterTimezoneOffsetHours };
}

// ------------------------------------------------------------------------------------------------ folders

export async function syncFolders(rt: Runtime, trigger: Trigger): Promise<void> {
  await withRun(rt, "folders", trigger, async (counts) => {
    const s = await loadSettings(rt);
    const folders: MsFolder[] = [];
    for await (const page of rt.ms!.folders(s.filterTimezoneOffsetHours)) folders.push(...page);

    // Slugs are unique across BOTH sources; everything else here only ever looks at MoySklad-owned categories.
    const all = await rt.db.select({ id: categories.id, msId: categories.msId, slug: categories.slug, source: categories.source }).from(categories);
    const existing = all.filter((c) => c.source === "moysklad");
    const byMsId = new Map(existing.map((c) => [c.msId, c]));
    const usedSlugs = new Set(all.map((c) => c.slug));

    const rows = folders.map((f) => {
      const known = byMsId.get(f.msId);
      let slug = known?.slug;
      if (!slug) {
        slug = slugify(f.name);
        if (usedSlugs.has(slug)) slug = `${slug}-${f.msId.slice(0, 4)}`;
        usedSlugs.add(slug);
      }
      return { msId: f.msId, name: f.name, pathName: f.pathName, slug, archived: f.archived, msUpdatedAt: f.updated, syncedAt: new Date() };
    });
    for (const part of chunk(rows, 200)) {
      await rt.db
        .insert(categories)
        .values(part)
        .onConflictDoUpdate({
          target: categories.msId,
          set: { name: ex(categories.name), pathName: ex(categories.pathName), archived: ex(categories.archived), msUpdatedAt: ex(categories.msUpdatedAt), syncedAt: ex(categories.syncedAt) },
        });
    }

    // Second pass: parents, now that every id exists.
    const idByMs = new Map((await rt.db.select({ id: categories.id, msId: categories.msId }).from(categories)).map((c) => [c.msId, c.id]));
    for (const f of folders) {
      const id = idByMs.get(f.msId);
      if (!id) continue;
      await rt.db
        .update(categories)
        .set({ parentId: f.parentMsId ? (idByMs.get(f.parentMsId) ?? null) : null })
        .where(eq(categories.id, id));
    }

    // Folders deleted in MoySklad: hide, never delete (products may still point at them). Manual categories are not ours to hide.
    const seen = new Set(folders.map((f) => f.msId));
    const gone = existing.filter((c) => !seen.has(c.msId)).map((c) => c.id);
    if (gone.length) await rt.db.update(categories).set({ archived: true }).where(inArray(categories.id, gone));

    counts.folders = folders.length;
    counts.hidden = gone.length;
  });
}

// ------------------------------------------------------------------------------------------------ products

function contentHash(p: MsProduct, categoryId: string | null, brandId: string | null, qtyStep: number): string {
  return createHash("sha1")
    .update(JSON.stringify([p.name, p.article, p.code, p.externalCode, p.barcodes, p.description, categoryId, brandId, p.uom, qtyStep, p.packSize, p.price, p.oldPrice, p.archived, p.updated.toISOString()]))
    .digest("hex");
}

export function qtyStepFor(uom: string | null, s: IntegrationSettings): number {
  if (!uom) return 1;
  return s.qtyStepByUom[uom.trim().toLowerCase()] ?? 1;
}

/** Upserts one page of mapped products (+ their brands and image rows). Shared by polling, full sync and webhook refetch. */
export async function upsertProducts(rt: Runtime, page: MsProduct[], s: IntegrationSettings, opts: { initialImport: boolean }, counts: Counts): Promise<void> {
  if (page.length === 0) return;
  const db: Db = rt.db;

  const moyskladCategories = () => db.select({ id: categories.id, msId: categories.msId }).from(categories).where(eq(categories.source, "moysklad"));
  let catRows = await moyskladCategories();
  let catByMs = new Map(catRows.map((c) => [c.msId, c.id]));
  // A product pointing at a folder we have not seen would be stored without a category and never revisited (its `updated` does not change
  // when a folder arrives). Refresh the folders now instead of leaving that hole.
  if (page.some((p) => p.folderMsId && !catByMs.has(p.folderMsId))) {
    await syncFolders(rt, "schedule");
    catRows = await moyskladCategories();
    catByMs = new Map(catRows.map((c) => [c.msId, c.id]));
  }

  const brandNames = [...new Set(page.map((p) => p.brandName).filter((b): b is string => !!b))];
  if (brandNames.length) {
    await db
      .insert(brands)
      .values(brandNames.map((name) => ({ name, slug: slugify(name) })))
      .onConflictDoNothing();
    // A different name that slugifies identically would have been skipped by the unique slug: give it a distinct slug.
    const have = new Set((await db.select({ name: brands.name }).from(brands).where(inArray(brands.name, brandNames))).map((b) => b.name));
    for (const name of brandNames.filter((n) => !have.has(n))) {
      await db.insert(brands).values({ name, slug: `${slugify(name)}-${createHash("md5").update(name).digest("hex").slice(0, 4)}` }).onConflictDoNothing();
    }
  }
  const brandByName = new Map(
    brandNames.length ? (await db.select({ id: brands.id, name: brands.name }).from(brands).where(inArray(brands.name, brandNames))).map((b) => [b.name, b.id]) : [],
  );

  const msIds = page.map((p) => p.msId);
  const existing = await db
    .select({ id: products.id, msId: products.msId, hash: products.contentHash })
    .from(products)
    .where(inArray(products.msId, msIds));
  const existingByMs = new Map(existing.map((e) => [e.msId, e]));

  const now = new Date();
  const toWrite = [];
  for (const p of page) {
    const categoryId = p.folderMsId ? (catByMs.get(p.folderMsId) ?? null) : null;
    const brandId = p.brandName ? (brandByName.get(p.brandName) ?? null) : null;
    const qtyStep = qtyStepFor(p.uom, s);
    const hash = contentHash(p, categoryId, brandId, qtyStep);
    const known = existingByMs.get(p.msId);
    if (known && known.hash === hash) {
      counts.unchanged = (counts.unchanged ?? 0) + 1;
      continue;
    }
    toWrite.push({
      msId: p.msId,
      msType: "product",
      slug: productSlug(p.name, p.msId),
      name: p.name,
      nameSearch: normalizeSearch(`${p.name} ${p.brandName ?? ""}`),
      article: p.article,
      code: p.code,
      externalCode: p.externalCode,
      barcodes: p.barcodes,
      description: p.description,
      categoryId,
      brandId,
      uom: p.uom,
      qtyStep,
      packSize: p.packSize,
      price: p.price ?? 0,
      oldPrice: p.oldPrice,
      archived: p.archived,
      msUpdatedAt: p.updated,
      // NULL for the initial import so "new arrivals" only ever contains products that appeared after launch.
      firstSeenAt: known ? undefined : opts.initialImport ? null : now,
      contentHash: hash,
      syncedAt: now,
    });
    counts[known ? "updated" : "created"] = (counts[known ? "updated" : "created"] ?? 0) + 1;
  }

  const idByMs = new Map(existing.map((e) => [e.msId, e.id]));
  for (const part of chunk(toWrite, 100)) {
    const written = await db
      .insert(products)
      .values(part)
      .onConflictDoUpdate({
        target: products.msId,
        set: {
          slug: ex(products.slug), name: ex(products.name), nameSearch: ex(products.nameSearch), article: ex(products.article), code: ex(products.code),
          externalCode: ex(products.externalCode), barcodes: ex(products.barcodes), description: ex(products.description), categoryId: ex(products.categoryId),
          brandId: ex(products.brandId), uom: ex(products.uom), qtyStep: ex(products.qtyStep), packSize: ex(products.packSize), price: ex(products.price),
          oldPrice: ex(products.oldPrice), archived: ex(products.archived), msUpdatedAt: ex(products.msUpdatedAt), contentHash: ex(products.contentHash), syncedAt: ex(products.syncedAt),
        },
      })
      .returning({ id: products.id, msId: products.msId });
    for (const w of written) idByMs.set(w.msId, w.id);
  }

  // Images: reconcile rows against what MoySklad lists now (changed files go back to "pending").
  let queued = 0;
  for (const p of page) {
    const productId = idByMs.get(p.msId);
    if (!productId || !p.imagesExpanded) continue;
    const desired = p.images.slice(0, s.maxImagesPerProduct);
    const rows = await db.select().from(productImages).where(eq(productImages.productId, productId));
    const byImg = new Map(rows.map((r) => [r.msImageId, r]));
    for (const [position, img] of desired.entries()) {
      const row = byImg.get(img.msImageId);
      const unchanged = row && row.filename === img.filename && row.size === img.size && row.msUpdatedAt?.getTime() === img.updated?.getTime();
      if (unchanged) {
        if (row.position !== position) await db.update(productImages).set({ position }).where(eq(productImages.id, row.id));
        continue;
      }
      await db
        .insert(productImages)
        .values({ productId, msImageId: img.msImageId, position, filename: img.filename, size: img.size, msUpdatedAt: img.updated, downloadHref: img.downloadHref, status: "pending" })
        .onConflictDoUpdate({
          target: [productImages.productId, productImages.msImageId],
          set: { position, filename: img.filename, size: img.size, msUpdatedAt: img.updated, downloadHref: img.downloadHref, status: "pending", attempts: 0, lastError: null },
        });
      queued++;
    }
    const keep = new Set(desired.map((d) => d.msImageId));
    const stale = rows.filter((r) => !keep.has(r.msImageId)).map((r) => r.id);
    if (stale.length) await db.delete(productImages).where(inArray(productImages.id, stale));
  }
  if (queued) {
    counts.imagesQueued = (counts.imagesQueued ?? 0) + queued;
    await enqueueSync(rt.queues, "images", "schedule");
  }
}

const WATERMARK = "products_watermark";
const OVERLAP_MS = 5 * 60_000;

export async function syncProducts(rt: Runtime, trigger: Trigger, mode: "incremental" | "full" = "incremental"): Promise<number | undefined> {
  return withRun(rt, mode === "full" ? "products_full" : "products", trigger, async (counts) => {
    const s = await loadSettings(rt);
    const cfg = mappingFrom(s);
    const watermark = mode === "incremental" ? await getState<string>(rt, WATERMARK) : null;
    const since = watermark ? new Date(new Date(watermark).getTime() - OVERLAP_MS) : undefined;
    const [{ n }] = (await rt.db.select({ n: sql<number>`count(*)::int` }).from(products)) as [{ n: number }];
    const initialImport = n === 0;

    let maxUpdated = watermark ? new Date(watermark) : new Date(0);
    for await (const page of rt.ms!.products(cfg, { since, filterOffsetHours: s.filterTimezoneOffsetHours })) {
      await upsertProducts(rt, page, s, { initialImport }, counts);
      counts.seen = (counts.seen ?? 0) + page.length;
      for (const p of page) if (p.updated > maxUpdated) maxUpdated = p.updated;
    }
    // Advance only after every page is committed: a crash re-reads the overlap, never skips rows.
    if (maxUpdated.getTime() > 0) await setState(rt, WATERMARK, maxUpdated.toISOString());
    if ((counts.created ?? 0) + (counts.updated ?? 0) > 0) await revalidateWeb(rt);
    return counts.seen ?? 0;
  });
}

/** Daily: products deleted in MoySklad vanish from the list without any event we can trust, so diff all ids. */
export async function reconcileProducts(rt: Runtime, trigger: Trigger): Promise<void> {
  await withRun(rt, "reconcile", trigger, async (counts) => {
    const msIds = new Set(await rt.ms!.allProductIds());
    // Only MoySklad-owned products can be "gone from MoySklad". Manual products were never there.
    const ours = await rt.db.select({ id: products.id, msId: products.msId }).from(products).where(and(eq(products.archived, false), eq(products.source, "moysklad")));
    const gone = ours.filter((p) => !msIds.has(p.msId)).map((p) => p.id);
    for (const part of chunk(gone, 500)) await rt.db.update(products).set({ archived: true, syncedAt: new Date() }).where(inArray(products.id, part));
    counts.checked = ours.length;
    counts.hidden = gone.length;
    if (gone.length) await revalidateWeb(rt);
  });
}

export async function productCountVisible(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(eq(products.archived, false), sql`${products.price} > 0`));
  return row?.n ?? 0;
}
