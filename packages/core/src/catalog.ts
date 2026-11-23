import { banners, brands, categories, categoryI18n, contentBlocks, featuredSlots, productImages, products, sql, type Db } from "@shop/db";
import {
  normalizeSearch,
  searchTokens,
  slugShortId,
  stockStatus,
  type BannerDTO,
  type BrandDTO,
  type CatalogPage,
  type CatalogQuery,
  type CategoryNode,
  type HomePayload,
  type IntegrationSettings,
  type Locale,
  type ProductCardData,
  type ProductDetail,
  type SuggestResult,
} from "@shop/shared";
import { mediaUrl } from "./media";
import type { Runtime } from "./runtime";
import { loadSettings } from "./settings";

type Rt = Pick<Runtime, "db">;

/** What a customer may see: not archived in MoySklad, has a price, not hidden by an admin overlay, optionally has a photo. */
function visible(s: Pick<IntegrationSettings, "requireImage">) {
  return sql`p.archived = false AND p.price > 0 AND COALESCE(o.hidden, false) = false${
    s.requireImage ? sql` AND EXISTS (SELECT 1 FROM product_images pi0 WHERE pi0.product_id = p.id AND pi0.status = 'ready')` : sql``
  }`;
}

const FROM = sql`FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN product_overlays o ON o.product_id = p.id`;
const CARD_COLUMNS = sql`p.id, p.slug, p.name, p.article, b.name AS brand, p.price, p.old_price, p.pack_size, p.uom, p.qty_step, p.available_qty,
  (SELECT storage_key FROM product_images pi WHERE pi.product_id = p.id AND pi.status = 'ready' AND pi.storage_key IS NOT NULL ORDER BY pi.position LIMIT 1) AS image_key`;

interface CardRow {
  id: string;
  slug: string;
  name: string;
  article: string;
  brand: string | null;
  price: number;
  old_price: number | null;
  pack_size: number | null;
  uom: string | null;
  qty_step: string | number;
  available_qty: string | number;
  image_key: string | null;
  [key: string]: unknown;
}

function toCard(r: CardRow, s: Pick<IntegrationSettings, "lowStockThreshold">): ProductCardData {
  const free = Number(r.available_qty);
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    article: r.article,
    brand: r.brand,
    price: Number(r.price),
    oldPrice: r.old_price === null ? null : Number(r.old_price),
    packSize: r.pack_size,
    unit: r.uom,
    qtyStep: Number(r.qty_step),
    stockStatus: stockStatus(free, s.lowStockThreshold),
    freeStock: free,
    imageUrl: r.image_key ? mediaUrl(r.image_key, "medium") : null,
  };
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

async function rows<T>(db: Db, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(q)).rows as T[];
}

// ------------------------------------------------------------------------------------------------ categories

interface CatRow {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  image_key: string | null;
  cnt: number;
}

const treeCache = new Map<string, { at: number; tree: CategoryNode[]; flat: Map<string, CategoryNode> }>();
const TREE_TTL_MS = 30_000;

export function clearCatalogCache(): void {
  treeCache.clear();
}

/** `includeEmpty`: also the sub-categories that have no products yet (the catalogue page lists them; the home page and counts do not). */
export async function categoryTree(rt: Rt, locale: Locale, opts: { includeEmpty?: boolean } = {}): Promise<{ tree: CategoryNode[]; flat: Map<string, CategoryNode> }> {
  const cacheKey = opts.includeEmpty ? `${locale}:all` : locale;
  const cached = treeCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TREE_TTL_MS) return cached;
  const s = await loadSettings(rt);
  const list = await rows<CatRow>(
    rt.db,
    sql`SELECT c.id, c.slug, COALESCE(i.name, c.name) AS name, c.parent_id, c.image_key,
          (SELECT count(*)::int FROM products p LEFT JOIN product_overlays o ON o.product_id = p.id WHERE p.category_id = c.id AND ${visible(s)}) AS cnt
        FROM categories c LEFT JOIN category_i18n i ON i.category_id = c.id AND i.locale = ${locale}
        WHERE c.archived = false ORDER BY c.sort_order, c.name`,
  );
  const flat = new Map<string, CategoryNode>();
  for (const r of list) flat.set(r.id, { id: r.id, slug: r.slug, name: r.name, parentId: r.parent_id, productCount: r.cnt, segment: null, covers: [], imageUrl: r.image_key ? mediaUrl(r.image_key, "large") : null, children: [] });
  // Photos for picture tiles: the store's own product photos, best-selling in-stock items first. Nothing to upload per category.
  const photos = await rows<{ category_id: string; storage_key: string }>(
    rt.db,
    sql`SELECT category_id, storage_key FROM (
          SELECT p.category_id, pi.storage_key,
                 row_number() OVER (PARTITION BY p.category_id ORDER BY (p.available_qty > 0) DESC, p.popularity DESC, p.first_seen_at DESC NULLS LAST) AS rn
          FROM products p LEFT JOIN product_overlays o ON o.product_id = p.id
          JOIN LATERAL (SELECT storage_key FROM product_images x WHERE x.product_id = p.id AND x.status = 'ready' AND x.storage_key IS NOT NULL ORDER BY x.position LIMIT 1) pi ON true
          WHERE p.category_id IS NOT NULL AND ${visible(s)}) t
        WHERE rn <= 3`,
  );
  for (const ph of photos) flat.get(ph.category_id)?.covers.push(mediaUrl(ph.storage_key, "medium"));
  const roots: CategoryNode[] = [];
  for (const node of flat.values()) {
    const parent = node.parentId ? flat.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const rollUp = (n: CategoryNode): number => {
    n.productCount += n.children.reduce((sum, c) => sum + rollUp(c), 0);
    // A parent without products of its own shows its children's photos, one from each first.
    for (let i = 0; n.covers.length < 3 && i < 3; i++) for (const c of n.children) if (c.covers[i] && n.covers.length < 3) n.covers.push(c.covers[i]!);
    return n.productCount;
  };
  roots.forEach(rollUp);
  // Empty sub-categories are hidden; top-level sections stay even when empty, so a new section the owner has just
  // created (e.g. computers next to stationery) is shown on the home page as "coming soon" instead of vanishing.
  const prune = (nodes: CategoryNode[], top = false): CategoryNode[] =>
    nodes.filter((n) => top || opts.includeEmpty || n.productCount > 0).map((n) => ({ ...n, children: prune(n.children) }));
  const mark = (n: CategoryNode, segment: CategoryNode["segment"]) => {
    n.segment = segment;
    n.children.forEach((c) => mark(c, segment));
  };
  const pruned = prune(roots, true);
  for (const r of pruned) mark(r, s.segmentRootCategories[r.slug] ?? null);
  const prunedFlat = new Map<string, CategoryNode>();
  const index = (n: CategoryNode) => {
    prunedFlat.set(n.id, n);
    n.children.forEach(index);
  };
  pruned.forEach(index);
  const value = { at: Date.now(), tree: pruned, flat: prunedFlat };
  treeCache.set(cacheKey, value);
  return value;
}

export async function categoryBySlug(rt: Rt, slug: string, locale: Locale): Promise<{ node: CategoryNode; path: { slug: string; name: string }[] } | null> {
  const { flat } = await categoryTree(rt, locale);
  const node = [...flat.values()].find((n) => n.slug === slug);
  if (!node) return null;
  const path: { slug: string; name: string }[] = [];
  for (let cur: CategoryNode | undefined = node; cur; cur = cur.parentId ? flat.get(cur.parentId) : undefined) path.unshift({ slug: cur.slug, name: cur.name });
  return { node, path };
}

// ------------------------------------------------------------------------------------------------ brands

export async function brandList(rt: Rt, limit = 200): Promise<BrandDTO[]> {
  const s = await loadSettings(rt);
  const list = await rows<{ id: string; slug: string; name: string; cnt: number }>(
    rt.db,
    sql`SELECT b.id, b.slug, b.name, count(p.id)::int AS cnt FROM brands b JOIN products p ON p.brand_id = b.id LEFT JOIN product_overlays o ON o.product_id = p.id
        WHERE ${visible(s)} GROUP BY b.id ORDER BY cnt DESC, b.name LIMIT ${limit}`,
  );
  return list.map((b) => ({ id: b.id, slug: b.slug, name: b.name, productCount: b.cnt }));
}

// ------------------------------------------------------------------------------------------------ listing & search

export async function listProducts(rt: Rt, q: CatalogQuery): Promise<CatalogPage> {
  const s = await loadSettings(rt);
  const where = [visible(s)];

  let categoryCte = sql``;
  if (q.category) {
    categoryCte = sql`WITH RECURSIVE tree AS (SELECT id FROM categories WHERE slug = ${q.category} UNION ALL SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id) `;
    where.push(sql`p.category_id IN (SELECT id FROM tree)`);
  }
  if (q.brand.length) where.push(sql`b.slug IN (${sql.join(q.brand.map((b) => sql`${b}`), sql`, `)})`);
  if (q.inStock) where.push(sql`p.available_qty > 0`);

  let rank = sql`0`;
  const term = q.q?.trim();
  if (term) {
    const norm = normalizeSearch(term);
    const tokens = searchTokens(term);
    const lower = term.toLowerCase();
    const like = `${escapeLike(lower)}%`;
    const nameMatch = tokens.length ? sql.join(tokens.map((t) => sql`p.name_search ILIKE ${`%${t}%`}`), sql` AND `) : sql`false`;
    where.push(sql`((${nameMatch}) OR lower(p.article) LIKE ${like} OR lower(p.code) LIKE ${like} OR ${term} = ANY(p.barcodes))`);
    rank = sql`CASE WHEN lower(p.article) = ${lower} OR ${term} = ANY(p.barcodes) THEN 0 WHEN lower(p.article) LIKE ${like} OR lower(p.code) LIKE ${like} THEN 1 WHEN p.name_search ILIKE ${`${norm}%`} THEN 2 ELSE 3 END`;
  }

  const whereNoPrice = sql.join(where, sql` AND `);
  const priceWhere = [...where];
  if (q.priceMin !== undefined) priceWhere.push(sql`p.price >= ${q.priceMin}`);
  if (q.priceMax !== undefined) priceWhere.push(sql`p.price <= ${q.priceMax}`);
  const whereAll = sql.join(priceWhere, sql` AND `);

  const stockFirst = sql`(p.available_qty > 0) DESC`;
  const order =
    q.sort === "price_asc" ? sql`p.price ASC, p.name`
    : q.sort === "price_desc" ? sql`p.price DESC, p.name`
    : q.sort === "new" ? sql`p.first_seen_at DESC NULLS LAST, p.ms_updated_at DESC NULLS LAST`
    : q.sort === "name" ? sql`${stockFirst}, p.name`
    : sql`${stockFirst}, p.popularity DESC, p.name`;
  const searchOrder = term ? sql`${rank}, similarity(p.name_search, ${normalizeSearch(term)}) DESC, ` : sql``;

  const offset = (q.page - 1) * q.pageSize;
  const [list, totals, range] = await Promise.all([
    rows<CardRow>(rt.db, sql`${categoryCte}SELECT ${CARD_COLUMNS} ${FROM} WHERE ${whereAll} ORDER BY ${searchOrder}${order} LIMIT ${q.pageSize} OFFSET ${offset}`),
    rows<{ n: number }>(rt.db, sql`${categoryCte}SELECT count(*)::int AS n ${FROM} WHERE ${whereAll}`),
    rows<{ lo: number | null; hi: number | null }>(rt.db, sql`${categoryCte}SELECT min(p.price) AS lo, max(p.price) AS hi ${FROM} WHERE ${whereNoPrice}`),
  ]);
  return {
    items: list.map((r) => toCard(r, s)),
    total: totals[0]?.n ?? 0,
    page: q.page,
    pageSize: q.pageSize,
    priceMin: Number(range[0]?.lo ?? 0),
    priceMax: Number(range[0]?.hi ?? 0),
  };
}

export async function suggest(rt: Rt, term: string, locale: Locale): Promise<SuggestResult> {
  const query = term.trim();
  if (query.length < 2) return { products: [], categories: [], brands: [] };
  const page = await listProducts(rt, { q: query, brand: [], inStock: false, sort: "popular", page: 1, pageSize: 6, locale });
  const norm = normalizeSearch(query);
  const { flat } = await categoryTree(rt, locale);
  const cats = [...flat.values()].filter((c) => normalizeSearch(c.name).includes(norm)).slice(0, 3).map((c) => ({ slug: c.slug, name: c.name }));
  const bs = (await brandList(rt)).filter((b) => normalizeSearch(b.name).includes(norm)).slice(0, 3).map((b) => ({ slug: b.slug, name: b.name }));
  return { products: page.items, categories: cats, brands: bs };
}

// ------------------------------------------------------------------------------------------------ product detail

export type ProductLookup = { product: ProductDetail } | { redirectTo: string } | null;

export async function getProduct(rt: Rt, slug: string, locale: Locale): Promise<ProductLookup> {
  const s = await loadSettings(rt);
  const fetchBy = (cond: ReturnType<typeof sql>) =>
    rows<CardRow & { description: string; barcodes: string[]; category_id: string | null; ms_id: string }>(
      rt.db,
      sql`SELECT ${CARD_COLUMNS}, p.description, p.barcodes, p.category_id, p.ms_id ${FROM} WHERE ${cond} AND ${visible(s)} LIMIT 1`,
    );
  let [row] = await fetchBy(sql`p.slug = ${slug}`);
  if (!row) {
    // A renamed product keeps its trailing short id: send the old link to the new one.
    const short = slugShortId(slug);
    if (short) [row] = await fetchBy(sql`p.ms_id LIKE ${`${short}%`}`);
    return row ? { redirectTo: row.slug } : null;
  }
  const images = await rt.db.execute(sql`SELECT storage_key FROM product_images WHERE product_id = ${row.id} AND status = 'ready' AND storage_key IS NOT NULL ORDER BY position`);
  const keys = (images.rows as { storage_key: string }[]).map((i) => i.storage_key);
  const categoryPath: { slug: string; name: string }[] = [];
  if (row.category_id) {
    const { flat } = await categoryTree(rt, locale);
    for (let cur: CategoryNode | undefined = flat.get(row.category_id); cur; cur = cur.parentId ? flat.get(cur.parentId) : undefined) categoryPath.unshift({ slug: cur.slug, name: cur.name });
  }
  return {
    product: {
      ...toCard(row, s),
      description: row.description,
      barcodes: row.barcodes,
      categoryPath,
      images: keys.map((k) => ({ small: mediaUrl(k, "small"), medium: mediaUrl(k, "medium"), large: mediaUrl(k, "large") })),
    },
  };
}

export async function relatedProducts(rt: Rt, productId: string, limit = 8): Promise<ProductCardData[]> {
  const s = await loadSettings(rt);
  const list = await rows<CardRow>(
    rt.db,
    sql`SELECT ${CARD_COLUMNS} ${FROM}
        WHERE ${visible(s)} AND p.id <> ${productId}
          AND (p.category_id = (SELECT category_id FROM products WHERE id = ${productId}) OR p.brand_id = (SELECT brand_id FROM products WHERE id = ${productId}))
        ORDER BY (p.category_id = (SELECT category_id FROM products WHERE id = ${productId})) DESC, (p.available_qty > 0) DESC, p.popularity DESC, p.name
        LIMIT ${limit}`,
  );
  return list.map((r) => toCard(r, s));
}

export async function productsByIds(rt: Rt, ids: string[]): Promise<ProductCardData[]> {
  if (ids.length === 0) return [];
  const s = await loadSettings(rt);
  const list = await rows<CardRow>(rt.db, sql`SELECT ${CARD_COLUMNS} ${FROM} WHERE ${visible(s)} AND p.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
  const byId = new Map(list.map((r) => [r.id, toCard(r, s)]));
  return ids.map((id) => byId.get(id)).filter((c): c is ProductCardData => !!c);
}

// ------------------------------------------------------------------------------------------------ home

async function slotProducts(rt: Rt, slot: string, s: IntegrationSettings, limit: number): Promise<ProductCardData[]> {
  const list = await rows<CardRow>(
    rt.db,
    sql`SELECT ${CARD_COLUMNS} ${FROM} JOIN featured_slots f ON f.product_id = p.id
        WHERE f.slot = ${slot} AND (f.active_from IS NULL OR f.active_from <= now()) AND (f.active_to IS NULL OR f.active_to >= now()) AND ${visible(s)}
        ORDER BY f.position, p.name LIMIT ${limit}`,
  );
  return list.map((r) => toCard(r, s));
}

async function autoProducts(rt: Rt, s: IntegrationSettings, extra: ReturnType<typeof sql>, order: ReturnType<typeof sql>, limit: number): Promise<ProductCardData[]> {
  const list = await rows<CardRow>(rt.db, sql`SELECT ${CARD_COLUMNS} ${FROM} WHERE ${visible(s)} AND ${extra} ORDER BY ${order} LIMIT ${limit}`);
  return list.map((r) => toCard(r, s));
}

export async function homePayload(rt: Rt, locale: Locale): Promise<HomePayload> {
  const s = await loadSettings(rt);
  const now = new Date();
  const bannerRows = await rt.db.select().from(banners).orderBy(banners.position);
  const bannerList: BannerDTO[] = bannerRows
    .filter((b) => b.active && (!b.locale || b.locale === locale) && (!b.startsAt || b.startsAt <= now) && (!b.endsAt || b.endsAt >= now))
    .map((b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, imageUrl: b.imageKey ? mediaUrl(b.imageKey, "large") : null, linkUrl: b.linkUrl }));

  // Curated slots win. Without them the sections fall back to REAL data only: offers = products with a genuine higher old price,
  // bestsellers = products that were actually ordered, new = products first seen after launch. Empty sections are simply hidden.
  const [featured, curatedNew, curatedOffers, curatedBest] = await Promise.all([
    slotProducts(rt, "featured", s, 12),
    slotProducts(rt, "new", s, 12),
    slotProducts(rt, "offers", s, 12),
    slotProducts(rt, "bestseller", s, 12),
  ]);
  const [autoNew, autoOffers, autoBest] = await Promise.all([
    curatedNew.length ? [] : autoProducts(rt, s, sql`p.first_seen_at IS NOT NULL`, sql`p.first_seen_at DESC`, 12),
    curatedOffers.length ? [] : autoProducts(rt, s, sql`p.old_price IS NOT NULL AND p.old_price > p.price`, sql`(p.available_qty > 0) DESC, (p.old_price - p.price) * 100 / p.old_price DESC`, 12),
    curatedBest.length ? [] : autoProducts(rt, s, sql`p.popularity > 0`, sql`p.popularity DESC`, 12),
  ]);
  const { tree } = await categoryTree(rt, locale);
  return {
    banners: bannerList,
    featured,
    newArrivals: curatedNew.length ? curatedNew : autoNew,
    offers: curatedOffers.length ? curatedOffers : autoOffers,
    bestsellers: curatedBest.length ? curatedBest : autoBest,
    categories: tree,
    brands: await brandList(rt, 24),
  };
}

export async function contentMap(rt: Rt): Promise<Record<string, { uz: string; ru: string }>> {
  const list = await rt.db.select().from(contentBlocks);
  return Object.fromEntries(list.filter((c) => c.uz || c.ru).map((c) => [c.key, { uz: c.uz, ru: c.ru }]));
}

/** For the sitemap: every public product and category slug, with a last-modified date. */
export async function sitemapEntries(rt: Rt): Promise<{ products: { slug: string; updatedAt: Date }[]; categories: { slug: string }[]; brands: { slug: string }[] }> {
  const s = await loadSettings(rt);
  const prods = await rows<{ slug: string; updated: Date | string | null }>(rt.db, sql`SELECT p.slug, COALESCE(p.ms_updated_at, p.synced_at) AS updated ${FROM} WHERE ${visible(s)} ORDER BY p.slug`);
  const { flat } = await categoryTree(rt, "uz");
  return {
    products: prods.map((p) => ({ slug: p.slug, updatedAt: new Date(p.updated ?? Date.now()) })),
    categories: [...flat.values()].map((c) => ({ slug: c.slug })),
    brands: (await brandList(rt)).map((b) => ({ slug: b.slug })),
  };
}

export { brands, categories, categoryI18n, featuredSlots, productImages, products };
