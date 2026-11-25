import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Principle: a catalogue row has exactly ONE owner, recorded in `source`:
 *  - 'moysklad': mirrors MoySklad and is written ONLY by sync code (admins may only hide it via product_overlays);
 *  - 'manual':   created and edited by the owner in the admin; sync code never touches it (every sync query filters on source).
 * Manual rows still get a generated UUID in `ms_id`, so slugs, short-id redirects and unique keys work unchanged.
 * Our own data (content, orders, customers, flags) lives in separate tables. Money is integer UZS.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "number" });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: "number" });

// ---------------------------------------------------------------------------------------------- config / sync

export const integrationSettings = pgTable("integration_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // full | products | stock | folders | images | reconcile | order_push | order_states | webhook_health
    status: text("status").notNull(), // running | ok | failed
    trigger: text("trigger").notNull().default("schedule"), // schedule | manual | webhook | boot
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    error: text("error"),
  },
  (t) => [index("sync_runs_kind_started").on(t.kind, t.startedAt)],
);

export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    requestId: text("request_id").notNull(),
    entityType: text("entity_type").notNull(),
    action: text("action").notNull(),
    href: text("href"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
    status: text("status").notNull().default("received"), // received | processed | ignored | failed
  },
  (t) => [uniqueIndex("webhook_events_request_entity").on(t.requestId, t.entityType, t.action, t.href)],
);

// ---------------------------------------------------------------------------------------------- catalog (MoySklad-owned)

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    msId: text("ms_id").notNull().unique(),
    /** moysklad | manual. See the principle at the top of this file. */
    source: text("source").notNull().default("moysklad"),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    pathName: text("path_name").notNull().default(""),
    slug: text("slug").notNull().unique(),
    archived: boolean("archived").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    /** The owner's own picture for this category (admin upload; ours, never touched by MoySklad sync). Null = product photos. */
    imageKey: text("image_key"),
    msUpdatedAt: ts("ms_updated_at"),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [index("categories_parent").on(t.parentId)],
);

export const categoryI18n = pgTable(
  "category_i18n",
  {
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.locale] })],
);

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  logoKey: text("logo_key"),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    msId: text("ms_id").notNull().unique(),
    /** moysklad | manual. Manual products are edited in the admin; their stock lives in available_qty directly (no stock_levels rows). */
    source: text("source").notNull().default("moysklad"),
    msType: text("ms_type").notNull().default("product"),
    slug: text("slug").notNull().unique(),
    /** The main (Uzbek) name: the slug, the admin, order lines and staff messages use it. */
    name: text("name").notNull(),
    /** The owner's Russian name for the /ru site and the Mini App in Russian. Empty = the main name is shown. Never set by MoySklad sync. */
    nameRu: text("name_ru").notNull().default(""),
    /** Normalised skeleton used for Latin/Cyrillic-tolerant search (both names and the brand). See shared/search.ts. */
    nameSearch: text("name_search").notNull().default(""),
    article: text("article").notNull().default(""),
    code: text("code").notNull().default(""),
    externalCode: text("external_code").notNull().default(""),
    barcodes: text("barcodes").array().notNull().default(sql`'{}'::text[]`),
    description: text("description").notNull().default(""),
    /** Russian description; empty = the main description is shown. */
    descriptionRu: text("description_ru").notNull().default(""),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    uom: text("uom"),
    qtyStep: qty("qty_step").notNull().default(1),
    packSize: integer("pack_size"),
    /** Integer UZS: salePrices[priceType].value / 100. buyPrice/minPrice are never stored. */
    price: money("price").notNull().default(0),
    oldPrice: money("old_price"),
    archived: boolean("archived").notNull().default(false),
    /** Denormalised sum of stock_levels.free_stock for fast filtering. */
    availableQty: qty("available_qty").notNull().default(0),
    /** Our own popularity counter, fed by placed orders. MoySklad has no such field. */
    popularity: integer("popularity").notNull().default(0),
    msUpdatedAt: ts("ms_updated_at"),
    /** NULL for the initial import, so "new arrivals" only contains products that appeared after launch. */
    firstSeenAt: ts("first_seen_at"),
    contentHash: text("content_hash").notNull().default(""),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [
    index("products_category").on(t.categoryId),
    index("products_brand").on(t.brandId),
    index("products_price").on(t.price),
    index("products_article").on(t.article),
    index("products_name_search_trgm").using("gin", t.nameSearch.op("gin_trgm_ops")),
  ],
);

export const stockLevels = pgTable(
  "stock_levels",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** '' = all stores summed by MoySklad; otherwise a MoySklad store id. */
    storeId: text("store_id").notNull().default(""),
    freeStock: qty("free_stock").notNull().default(0),
    stock: qty("stock").notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.storeId] })],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** MoySklad image id, or "upload-<uuid>" for a photo uploaded in the admin (download_href is then empty and status 'ready'). */
    msImageId: text("ms_image_id").notNull(),
    position: integer("position").notNull().default(0),
    filename: text("filename").notNull().default(""),
    size: integer("size").notNull().default(0),
    msUpdatedAt: ts("ms_updated_at"),
    downloadHref: text("download_href").notNull().default(""),
    /** Content-hashed key under our media storage, without extension: e.g. "ab/abcdef0123456789". Null until downloaded. */
    storageKey: text("storage_key"),
    width: integer("width"),
    height: integer("height"),
    status: text("status").notNull().default("pending"), // pending | ready | failed
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [uniqueIndex("product_images_unique").on(t.productId, t.msImageId), index("product_images_status").on(t.status)],
);

/** Storefront visibility. For MoySklad products this is the ONLY thing admins may change; manual products use it too. */
export const productOverlays = pgTable("product_overlays", {
  productId: uuid("product_id")
    .primaryKey()
    .references(() => products.id, { onDelete: "cascade" }),
  hidden: boolean("hidden").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------------------------- content (ours)

export const banners = pgTable("banners", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** null = shown in every language. */
  locale: text("locale"),
  title: text("title").notNull().default(""),
  subtitle: text("subtitle").notNull().default(""),
  imageKey: text("image_key"),
  linkUrl: text("link_url").notNull().default("/"),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  startsAt: ts("starts_at"),
  endsAt: ts("ends_at"),
});

export const featuredSlots = pgTable(
  "featured_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slot: text("slot").notNull(), // featured | new | offers | bestseller
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    activeFrom: ts("active_from"),
    activeTo: ts("active_to"),
  },
  (t) => [uniqueIndex("featured_slots_unique").on(t.slot, t.productId)],
);

/** Footer contacts, delivery rules, static pages ("page.about", "page.offer"...). Empty until the owner provides them; the site never invents any. */
export const contentBlocks = pgTable("content_blocks", {
  key: text("key").primaryKey(),
  uz: text("uz").notNull().default(""),
  ru: text("ru").notNull().default(""),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------------------------- customers & orders

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: bigint("telegram_id", { mode: "number" }).unique(),
    username: text("username"),
    phone: text("phone"),
    name: text("name").notNull().default(""),
    language: text("language").notNull().default("uz"),
    msCounterpartyId: text("ms_counterparty_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("customers_phone").on(t.phone)],
);

export const addresses = pgTable("addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  text: text("text").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
});

export const favorites = pgTable(
  "favorites",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.productId] })],
);

export const carts = pgTable("carts", {
  customerId: uuid("customer_id")
    .primaryKey()
    .references(() => customers.id, { onDelete: "cascade" }),
  items: jsonb("items").$type<{ productId: string; quantity: number }[]>().notNull().default([]),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: integer("seq").notNull().generatedAlwaysAsIdentity({ startWith: 1001 }),
    /** Human number, also sent to MoySklad as externalCode. */
    number: text("number").notNull().default(""),
    /** Unguessable id for the guest confirmation / status link. */
    publicId: uuid("public_id").notNull().defaultRandom().unique(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    channel: text("channel").notNull(), // web | tma
    /** Our delivery pipeline status: pending_sync | synced | failed | cancelled | local (handled in our admin, never sent to MoySklad). */
    syncStatus: text("sync_status").notNull().default("pending_sync"),
    /** Cache of the MoySklad state name (the real order status) for orders sent to MoySklad. */
    msState: text("ms_state"),
    /** For orders handled in our admin (sync_status = 'local'): one of LOCAL_ORDER_STATUSES. */
    localStatus: text("local_status"),
    msStateType: text("ms_state_type"), // Regular | Successful | Unsuccessful
    idempotencyKey: text("idempotency_key").notNull().unique(),
    /** Generated BEFORE the first MoySklad call so a retry can look the order up instead of creating a duplicate. */
    msSyncId: uuid("ms_sync_id").notNull().defaultRandom().unique(),
    msOrderId: text("ms_order_id"),
    msOrderName: text("ms_order_name"),
    total: money("total").notNull(),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone").notNull(),
    deliveryMethod: text("delivery_method").notNull().default("delivery"), // delivery | pickup
    address: text("address").notNull().default(""),
    comment: text("comment").notNull().default(""),
    telegramId: bigint("telegram_id", { mode: "number" }),
    language: text("language").notNull().default("uz"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    ipHash: text("ip_hash"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("orders_customer").on(t.customerId),
    index("orders_sync_status").on(t.syncStatus),
    index("orders_phone_created").on(t.contactPhone, t.createdAt),
    index("orders_ms_order").on(t.msOrderId),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    /** '' for a manual product (it does not exist in MoySklad). */
    msProductId: text("ms_product_id").notNull(),
    /** Snapshot at order time. */
    name: text("name").notNull(),
    article: text("article").notNull().default(""),
    unit: text("unit"),
    unitPrice: money("unit_price").notNull(),
    quantity: qty("quantity").notNull(),
    lineTotal: money("line_total").notNull(),
  },
  (t) => [index("order_items_order").on(t.orderId)],
);

// ---------------------------------------------------------------------------------------------- admin, audit, outbox

/** One row per Gemini call that came back (tokens were spent even when the answer was unusable). The monthly limit sums these. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id"),
    /** describe | translate | analyze | advice */
    feature: text("feature").notNull(),
    model: text("model").notNull().default(""),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    ok: boolean("ok").notNull().default(true),
    error: text("error").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("ai_usage_created").on(t.createdAt)],
);

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastLoginAt: ts("last_login_at"),
});

export const adminSessions = pgTable(
  "admin_sessions",
  {
    /** sha256 of the cookie token; the token itself is never stored. */
    id: text("id").primaryKey(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("admin_sessions_admin").on(t.adminId)],
);

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  adminId: uuid("admin_id").references(() => adminUsers.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Telegram messages to send (order status to a customer, new-order alert to staff). Kept when no bot token is configured, so nothing is lost. */
export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(), // order_status | staff_new_order | sync_alert
    chatId: bigint("chat_id", { mode: "number" }),
    text: text("text").notNull(),
    status: text("status").notNull().default("pending"), // pending | sent | failed | skipped
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: ts("created_at").notNull().defaultNow(),
    sentAt: ts("sent_at"),
  },
  (t) => [index("notifications_status").on(t.status)],
);
