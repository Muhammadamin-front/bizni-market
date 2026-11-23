import {
  adminUsers, auditLog, banners, categories, categoryI18n, contentBlocks, count, customers, desc, eq, featuredSlots, ilike, inArray, notifications, or, orderItems, orders,
  productImages, products, sql, syncRuns, webhookEvents, and,
} from "@shop/db";
import {
  AuthError, audit, autoConfigure, enqueueSync, generateTotpSecret, getOrderStates, hashPassword, loadAccountOptions, loadSettings, loginAdmin, logoutAdmin, passwordProblem,
  BOT_DESCRIPTION_MAX, BOT_SHORT_DESCRIPTION_MAX, contentMap, processImage, productsByIds, pushOrderState, retryOrderPush, saveSettings, setupTelegram, stockSummary, TelegramApi, toOrderView, totpUri, verifyPassword, verifyTotp, clearCatalogCache,
  addProductImage, createManualCategory, createManualProduct, deleteManualCategory, deleteManualProduct, deleteProductImage, getAdminProduct, listAdminCategories, mediaUrl,
  quickEditProduct, reorderProductImages, revalidateWeb, setLocalOrderStatus, updateCategory, updateManualProduct,
  type Runtime, type SyncJobName,
} from "@shop/core";
import { IntegrationSettingsSchema, LOCAL_ORDER_STATUSES, ManualCategoryInput, ManualProductInput, normalizeSearch, ProductQuickEdit } from "@shop/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ADMIN_COOKIE, allow, requireAdmin } from "../guards";

const Page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) });
const RUNNABLE = ["full", "products", "stock", "folders", "images", "reconcile", "webhook-health", "order-states"] as const;

export function adminRoutes(app: FastifyInstance, rt: Runtime) {
  const guard = requireAdmin(rt);
  const secureCookie = rt.env.PUBLIC_URL.startsWith("https://");

  // ------------------------------------------------------------------------------------------ session
  app.post("/v1/admin/login", async (req, reply) => {
    const body = z.object({ email: z.string().max(200), password: z.string().max(200), totp: z.string().max(10).optional() }).parse(req.body);
    // CSRF for login is covered by SameSite + a JSON body, but cap brute force per IP and per account name.
    if (!(await allow(rt, `adminlogin:ip:${req.clientIp}`, 20, 900)) || !(await allow(rt, `adminlogin:acct:${body.email.toLowerCase()}`, 10, 900))) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    try {
      const { token, expiresAt, adminId } = await loginAdmin(rt, body.email, body.password, body.totp, { ip: req.clientIp, userAgent: String(req.headers["user-agent"] ?? "") });
      await audit(rt, adminId, "login", "admin", adminId);
      return reply
        .setCookie(ADMIN_COOKIE, token, { httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/", expires: expiresAt })
        .send({ ok: true });
    } catch (err) {
      if (err instanceof AuthError) return reply.code(err.code === "locked" ? 423 : 401).send({ error: err.code });
      throw err;
    }
  });

  app.post("/v1/admin/logout", { preHandler: guard }, async (req, reply) => {
    await logoutAdmin(rt, req.cookies[ADMIN_COOKIE] ?? "");
    return reply.clearCookie(ADMIN_COOKIE, { path: "/" }).send({ ok: true });
  });

  app.get("/v1/admin/me", { preHandler: guard }, async (req) => ({ email: req.admin!.email, totpEnabled: req.admin!.totpEnabled, connected: !!rt.ms }));

  app.post("/v1/admin/password", { preHandler: guard }, async (req, reply) => {
    const body = z.object({ current: z.string(), next: z.string().max(200) }).parse(req.body);
    const [user] = await rt.db.select().from(adminUsers).where(eq(adminUsers.id, req.admin!.adminId)).limit(1);
    if (!user || !(await verifyPassword(body.current, user.passwordHash))) return reply.code(401).send({ error: "invalid_credentials" });
    const problem = passwordProblem(body.next, user.email);
    if (problem) return reply.code(422).send({ error: "weak_password", message: problem });
    await rt.db.update(adminUsers).set({ passwordHash: await hashPassword(body.next) }).where(eq(adminUsers.id, user.id));
    await audit(rt, user.id, "password_change", "admin", user.id);
    return { ok: true };
  });

  app.post("/v1/admin/totp/setup", { preHandler: guard }, async (req) => {
    const secret = generateTotpSecret();
    await rt.db.update(adminUsers).set({ totpSecret: secret, totpEnabled: false }).where(eq(adminUsers.id, req.admin!.adminId));
    return { secret, uri: totpUri(req.admin!.email, secret) };
  });
  app.post("/v1/admin/totp/enable", { preHandler: guard }, async (req, reply) => {
    const { code } = z.object({ code: z.string() }).parse(req.body);
    const [user] = await rt.db.select().from(adminUsers).where(eq(adminUsers.id, req.admin!.adminId)).limit(1);
    if (!user?.totpSecret || !verifyTotp(user.totpSecret, code)) return reply.code(422).send({ error: "invalid_code" });
    await rt.db.update(adminUsers).set({ totpEnabled: true }).where(eq(adminUsers.id, user.id));
    await audit(rt, user.id, "totp_enable", "admin", user.id);
    return { ok: true };
  });
  app.post("/v1/admin/totp/disable", { preHandler: guard }, async (req, reply) => {
    const { password } = z.object({ password: z.string() }).parse(req.body);
    const [user] = await rt.db.select().from(adminUsers).where(eq(adminUsers.id, req.admin!.adminId)).limit(1);
    if (!user || !(await verifyPassword(password, user.passwordHash))) return reply.code(401).send({ error: "invalid_credentials" });
    await rt.db.update(adminUsers).set({ totpEnabled: false, totpSecret: null }).where(eq(adminUsers.id, user.id));
    await audit(rt, user.id, "totp_disable", "admin", user.id);
    return { ok: true };
  });

  // ------------------------------------------------------------------------------------------ dashboard
  app.get("/v1/admin/dashboard", { preHandler: guard }, async () => {
    const lastRuns = (
      await rt.db.execute(sql`SELECT DISTINCT ON (kind) kind, status, trigger, started_at, finished_at, counts, error FROM sync_runs ORDER BY kind, started_at DESC`)
    ).rows as { kind: string; status: string; started_at: string; finished_at: string | null; counts: Record<string, number>; error: string | null }[];
    const [catalog] = (
      await rt.db.execute(sql`SELECT
        count(*) FILTER (WHERE p.archived = false AND p.price > 0 AND COALESCE(o.hidden,false) = false)::int AS visible,
        count(*) FILTER (WHERE p.archived = false AND p.price <= 0)::int AS without_price,
        count(*) FILTER (WHERE p.archived = false AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id AND i.status = 'ready'))::int AS without_image,
        count(*) FILTER (WHERE COALESCE(o.hidden,false))::int AS hidden,
        count(*) FILTER (WHERE p.archived)::int AS archived,
        count(*) FILTER (WHERE p.source = 'manual')::int AS manual,
        count(*)::int AS total
        FROM products p LEFT JOIN product_overlays o ON o.product_id = p.id`)
    ).rows as Record<string, number>[];
    const [imgs] = (await rt.db.execute(sql`SELECT count(*) FILTER (WHERE status='pending')::int AS pending, count(*) FILTER (WHERE status='failed')::int AS failed, count(*) FILTER (WHERE status='ready')::int AS ready FROM product_images`)).rows as Record<string, number>[];
    const [ord] = (
      await rt.db.execute(sql`SELECT count(*) FILTER (WHERE sync_status='pending_sync')::int AS pending, count(*) FILTER (WHERE sync_status='failed')::int AS failed,
        count(*) FILTER (WHERE sync_status='local' AND local_status='new')::int AS local_new,
        count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last_day, count(*)::int AS total FROM orders`)
    ).rows as Record<string, number>[];
    const [hooks] = (await rt.db.execute(sql`SELECT count(*)::int AS last_day, max(received_at) AS last_at FROM webhook_events WHERE received_at > now() - interval '24 hours'`)).rows as { last_day: number; last_at: string | null }[];
    const settings = await loadSettings(rt);
    // Both languages: the admin shows the one the owner picked.
    const warnings: { ru: string; uz: string }[] = [];
    if (!rt.ms && (catalog?.total ?? 0) === 0) warnings.push({ ru: "Каталог пуст: добавьте категории и товары в разделе «Товары».", uz: "Katalog boʻsh: «Tovarlar» boʻlimida kategoriya va tovarlar qoʻshing." });
    if (rt.ms && !settings.priceTypeId) warnings.push({ ru: "Не выбран тип цены (Настройки).", uz: "Narx turi tanlanmagan (Sozlamalar)." });
    if (rt.ms && !settings.organizationId) warnings.push({ ru: "Не выбрана организация для заказов (Настройки).", uz: "Buyurtmalar uchun tashkilot tanlanmagan (Sozlamalar)." });
    if (!rt.env.TELEGRAM_BOT_TOKEN) warnings.push({ ru: "Нет токена Telegram-бота: уведомления не отправляются (только записываются).", uz: "Telegram bot tokeni yoʻq: bildirishnomalar yuborilmaydi (faqat qayd etiladi)." });
    if (!rt.env.PUBLIC_URL.startsWith("https://")) warnings.push({ ru: "PUBLIC_URL не https: Mini App и вебхуки работать не будут.", uz: "PUBLIC_URL https emas: Mini App va vebxuklar ishlamaydi." });
    return {
      connected: !!rt.ms,
      demo: rt.demo,
      breakerOpenUntil: rt.ms ? await rt.ms.circuit.openUntil() : 0,
      lastRuns,
      catalog,
      stock: await stockSummary(rt),
      images: imgs,
      orders: ord,
      webhooks: { events24h: hooks?.last_day ?? 0, lastAt: hooks?.last_at ?? null, configured: !!rt.env.MOYSKLAD_WEBHOOK_SECRET },
      queues: {
        sync: await rt.queues.sync.getJobCounts("waiting", "active", "failed", "delayed"),
        orders: await rt.queues.orders.getJobCounts("waiting", "active", "failed", "delayed"),
        media: await rt.queues.media.getJobCounts("waiting", "active", "failed", "delayed"),
      },
      telegram: { botToken: !!rt.env.TELEGRAM_BOT_TOKEN, username: rt.env.TELEGRAM_BOT_USERNAME || null },
      warnings,
    };
  });

  // ------------------------------------------------------------------------------------------ sync
  app.get("/v1/admin/sync", { preHandler: guard }, async () => ({
    runs: await rt.db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(60),
    breakerOpenUntil: rt.ms ? await rt.ms.circuit.openUntil() : 0,
  }));

  app.post("/v1/admin/sync/run", { preHandler: guard }, async (req, reply) => {
    const { kind } = z.object({ kind: z.enum(RUNNABLE) }).parse(req.body);
    if (!rt.ms) return reply.code(409).send({ error: "not_connected" });
    await enqueueSync(rt.queues, kind as SyncJobName, "manual");
    await audit(rt, req.admin!.adminId, "sync_run", "sync", kind);
    return { queued: kind };
  });

  app.post("/v1/admin/sync/breaker-reset", { preHandler: guard }, async (req, reply) => {
    if (!rt.ms) return reply.code(409).send({ error: "not_connected" });
    await rt.ms.circuit.reset();
    await audit(rt, req.admin!.adminId, "breaker_reset", "sync", null);
    return { ok: true };
  });

  // ------------------------------------------------------------------------------------------ settings
  app.get("/v1/admin/settings", { preHandler: guard }, async () => {
    let options = null;
    let optionsError: string | null = null;
    try {
      options = await loadAccountOptions(rt);
    } catch (err) {
      optionsError = (err as Error).message;
    }
    return { settings: await loadSettings(rt), options, optionsError, connected: !!rt.ms, demo: rt.demo };
  });

  app.put("/v1/admin/settings", { preHandler: guard }, async (req) => {
    const body = z.record(z.string(), z.unknown()).parse(req.body);
    const known = Object.fromEntries(Object.entries(body).filter(([k]) => k in IntegrationSettingsSchema.shape));
    const before = await loadSettings(rt);
    const next = await saveSettings(rt, known as never);
    clearCatalogCache();
    await audit(rt, req.admin!.adminId, "settings_update", "settings", null, { keys: Object.keys(known) });
    // Changing what a price or stock means must be applied to the data already synced.
    const priceChanged = before.priceTypeId !== next.priceTypeId || before.oldPriceTypeId !== next.oldPriceTypeId || before.brandAttributeId !== next.brandAttributeId || before.filterTimezoneOffsetHours !== next.filterTimezoneOffsetHours;
    const stockChanged = JSON.stringify(before.storeIds) !== JSON.stringify(next.storeIds);
    if (rt.ms && priceChanged) await rt.queues.sync.add("full", { trigger: "manual" }, { jobId: "full-waiting", removeOnComplete: true, removeOnFail: true });
    else if (rt.ms && stockChanged) await enqueueSync(rt.queues, "stock", "manual");
    return { settings: next, resync: priceChanged ? "full" : stockChanged ? "stock" : null };
  });

  app.post("/v1/admin/settings/autoconfigure", { preHandler: guard }, async (req, reply) => {
    if (!rt.ms) return reply.code(409).send({ error: "not_connected" });
    const report = await autoConfigure(rt);
    await audit(rt, req.admin!.adminId, "autoconfigure", "settings", null);
    return report;
  });

  app.get("/v1/admin/order-states", { preHandler: guard }, async () => getOrderStates(rt));

  // ------------------------------------------------------------------------------------------ products
  // Manual products (source = 'manual') are fully edited here. MoySklad products are read-only apart from "hidden".
  const idParam = (req: { params: unknown }) => z.uuid().parse((req.params as { id: string }).id);

  app.get("/v1/admin/products", { preHandler: guard }, async (req) => {
    const q = Page.extend({
      q: z.string().max(100).optional(),
      filter: z.enum(["all", "hidden", "no_image", "no_price", "archived", "out", "manual"]).default("all"),
      category: z.uuid().optional(),
    }).parse(req.query);
    const where = [];
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(sql`(p.name ILIKE ${like} OR p.article ILIKE ${like} OR p.code ILIKE ${like} OR p.name_search ILIKE ${`%${normalizeSearch(q.q)}%`} OR ${q.q.trim()} = ANY(p.barcodes))`);
    }
    if (q.filter === "hidden") where.push(sql`COALESCE(o.hidden,false)`);
    if (q.filter === "no_image") where.push(sql`NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id AND i.status = 'ready')`);
    if (q.filter === "no_price") where.push(sql`p.price <= 0`);
    if (q.filter === "archived") where.push(sql`p.archived`);
    if (q.filter === "out") where.push(sql`p.archived = false AND p.available_qty <= 0`);
    if (q.filter === "manual") where.push(sql`p.source = 'manual'`);
    if (q.category) where.push(sql`p.category_id = ${q.category}`);
    const cond = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
    const rows = (
      await rt.db.execute(sql`SELECT p.id, p.slug, p.name, p.article, p.price, p.old_price, p.available_qty, p.uom, p.archived, p.source, p.ms_updated_at, b.name AS brand, c.name AS category,
        COALESCE(o.hidden,false) AS hidden,
        (SELECT storage_key FROM product_images i WHERE i.product_id = p.id AND i.status='ready' AND i.storage_key IS NOT NULL ORDER BY i.position LIMIT 1) AS image_key,
        (SELECT count(*)::int FROM product_images i WHERE i.product_id = p.id AND i.status='ready') AS images_ready,
        (SELECT count(*)::int FROM product_images i WHERE i.product_id = p.id AND i.status<>'ready') AS images_pending
        FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN product_overlays o ON o.product_id = p.id
        ${cond} ORDER BY (p.source = 'manual') DESC, p.first_seen_at DESC NULLS LAST, p.name LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`)
    ).rows as { image_key: string | null }[];
    const totals = (await rt.db.execute(sql`SELECT count(*)::int AS n FROM products p LEFT JOIN product_overlays o ON o.product_id = p.id ${cond}`)).rows as { n: number }[];
    return {
      rows: rows.map(({ image_key, ...r }) => ({ ...r, thumb: image_key ? mediaUrl(image_key, "small") : null })),
      total: totals[0]?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
      connected: !!rt.ms,
    };
  });

  app.get("/v1/admin/products/:id", { preHandler: guard }, async (req) => getAdminProduct(rt, idParam(req)));

  app.post("/v1/admin/products", { preHandler: guard }, async (req, reply) => {
    const id = await createManualProduct(rt, ManualProductInput.parse(req.body));
    await audit(rt, req.admin!.adminId, "product_create", "product", id);
    return reply.code(201).send(await getAdminProduct(rt, id));
  });

  app.put("/v1/admin/products/:id", { preHandler: guard }, async (req) => {
    const id = idParam(req);
    await updateManualProduct(rt, id, ManualProductInput.parse(req.body));
    await audit(rt, req.admin!.adminId, "product_update", "product", id);
    return getAdminProduct(rt, id);
  });

  // Inline edits from the list. For a MoySklad product only { hidden } is accepted (price/stock answer 409: they live in MoySklad).
  app.patch("/v1/admin/products/:id", { preHandler: guard }, async (req) => {
    const id = idParam(req);
    const edit = ProductQuickEdit.parse(req.body);
    await quickEditProduct(rt, id, edit);
    const action = edit.hidden === undefined ? "product_quick_edit" : edit.hidden ? "product_hide" : "product_show";
    await audit(rt, req.admin!.adminId, action, "product", id, { keys: Object.keys(edit) });
    return { ok: true };
  });

  app.delete("/v1/admin/products/:id", { preHandler: guard }, async (req, reply) => {
    const id = idParam(req);
    await deleteManualProduct(rt, id);
    await audit(rt, req.admin!.adminId, "product_delete", "product", id);
    return reply.code(204).send();
  });

  /** Clears the hand-made catalogue in one go (e.g. the sample products the shop started with). Categories, banners and orders stay. */
  app.post("/v1/admin/products/delete-all-manual", { preHandler: guard }, async (req, reply) => {
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body);
    if (confirm !== "DELETE") return reply.code(400).send({ error: "confirm_required" });
    const gone = await rt.db.delete(products).where(eq(products.source, "manual")).returning({ id: products.id });
    clearCatalogCache();
    await revalidateWeb(rt, ["catalog"], { immediate: true });
    await audit(rt, req.admin!.adminId, "product_delete_all_manual", "product", null, { count: gone.length });
    return { deleted: gone.length };
  });

  // Raw image bytes (the admin downsizes big phone photos in the browser first). Every photo becomes a 1:1 white-background square.
  app.post("/v1/admin/products/:id/images", { preHandler: guard, bodyLimit: 15 * 1024 * 1024 }, async (req, reply) => {
    const id = idParam(req);
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: "send_image_bytes" });
    const detail = await addProductImage(rt, id, req.body);
    await audit(rt, req.admin!.adminId, "product_image_add", "product", id);
    return detail;
  });

  app.delete("/v1/admin/products/:id/images/:imageId", { preHandler: guard }, async (req) => {
    const id = idParam(req);
    const imageId = z.uuid().parse((req.params as { imageId: string }).imageId);
    const detail = await deleteProductImage(rt, id, imageId);
    await audit(rt, req.admin!.adminId, "product_image_delete", "product", id);
    return detail;
  });

  app.put("/v1/admin/products/:id/images", { preHandler: guard }, async (req) => {
    const id = idParam(req);
    const { ids } = z.object({ ids: z.array(z.uuid()).max(20) }).parse(req.body);
    return reorderProductImages(rt, id, ids);
  });

  app.get("/v1/admin/brands", { preHandler: guard }, async () => (await rt.db.execute(sql`SELECT name FROM brands ORDER BY name`)).rows.map((r) => (r as { name: string }).name));

  // ------------------------------------------------------------------------------------------ featured slots
  const SLOTS = z.enum(["featured", "new", "offers", "bestseller"]);
  app.get("/v1/admin/featured/:slot", { preHandler: guard }, async (req) => {
    const slot = SLOTS.parse((req.params as { slot: string }).slot);
    const rows = await rt.db.select().from(featuredSlots).where(eq(featuredSlots.slot, slot)).orderBy(featuredSlots.position);
    const cards = await productsByIds(rt, rows.map((r) => r.productId));
    return cards;
  });
  app.put("/v1/admin/featured/:slot", { preHandler: guard }, async (req) => {
    const slot = SLOTS.parse((req.params as { slot: string }).slot);
    const { productIds } = z.object({ productIds: z.array(z.uuid()).max(24) }).parse(req.body);
    await rt.db.transaction(async (tx) => {
      await tx.delete(featuredSlots).where(eq(featuredSlots.slot, slot));
      if (productIds.length) await tx.insert(featuredSlots).values(productIds.map((productId, position) => ({ slot, productId, position })));
    });
    await audit(rt, req.admin!.adminId, "featured_update", "featured", slot, { count: productIds.length });
    return { ok: true };
  });

  // ------------------------------------------------------------------------------------------ banners
  const BannerBody = z.object({
    locale: z.enum(["uz", "ru"]).nullable().default(null),
    title: z.string().max(120).default(""),
    subtitle: z.string().max(240).default(""),
    linkUrl: z.string().max(500).regex(/^(\/|https:\/\/)/, "link must start with / or https://").default("/"),
    position: z.number().int().default(0),
    active: z.boolean().default(true),
    startsAt: z.coerce.date().nullable().default(null),
    endsAt: z.coerce.date().nullable().default(null),
  });
  // The home page is cached by the site: expire it so a banner change shows on the next visit.
  const bannersChanged = () => revalidateWeb(rt, ["catalog"], { immediate: true });
  app.get("/v1/admin/banners", { preHandler: guard }, async () => rt.db.select().from(banners).orderBy(banners.position));
  app.post("/v1/admin/banners", { preHandler: guard }, async (req) => {
    const [row] = await rt.db.insert(banners).values(BannerBody.parse(req.body)).returning();
    await audit(rt, req.admin!.adminId, "banner_create", "banner", row!.id);
    await bannersChanged();
    return row;
  });
  app.patch("/v1/admin/banners/:id", { preHandler: guard }, async (req) => {
    const id = z.uuid().parse((req.params as { id: string }).id);
    const [row] = await rt.db.update(banners).set(BannerBody.partial().parse(req.body)).where(eq(banners.id, id)).returning();
    await audit(rt, req.admin!.adminId, "banner_update", "banner", id);
    await bannersChanged();
    return row;
  });
  app.delete("/v1/admin/banners/:id", { preHandler: guard }, async (req, reply) => {
    const id = z.uuid().parse((req.params as { id: string }).id);
    await rt.db.delete(banners).where(eq(banners.id, id));
    await audit(rt, req.admin!.adminId, "banner_delete", "banner", id);
    await bannersChanged();
    return reply.code(204).send();
  });
  app.post("/v1/admin/banners/:id/image", { preHandler: guard, bodyLimit: 6 * 1024 * 1024 }, async (req, reply) => {
    const id = z.uuid().parse((req.params as { id: string }).id);
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: "send_image_bytes" });
    // An unusable file is an ImageError: the error handler answers 413/422 with the reason (too small, too large, unreadable).
    const done = await processImage(rt.env.MEDIA_DIR, req.body);
    await rt.db.update(banners).set({ imageKey: done.storageKey }).where(eq(banners.id, id));
    await bannersChanged();
    return { imageKey: done.storageKey };
  });

  // ------------------------------------------------------------------------------------------ content & category names
  app.get("/v1/admin/content", { preHandler: guard }, async () => rt.db.select().from(contentBlocks).orderBy(contentBlocks.key));
  app.put("/v1/admin/content/:key", { preHandler: guard }, async (req) => {
    const key = z.string().regex(/^[a-z0-9._-]{1,80}$/).parse((req.params as { key: string }).key);
    const max = key === "bot.description" ? BOT_DESCRIPTION_MAX : key === "bot.shortDescription" ? BOT_SHORT_DESCRIPTION_MAX : key === "bot.welcome" ? 4000 : key.startsWith("page.") ? 20_000 : 2000;
    const body = z.object({ uz: z.string().trim().max(max).default(""), ru: z.string().trim().max(max).default("") }).parse(req.body);
    await rt.db.insert(contentBlocks).values({ key, ...body }).onConflictDoUpdate({ target: contentBlocks.key, set: { ...body, updatedAt: new Date() } });
    await audit(rt, req.admin!.adminId, "content_update", "content", key);
    // Shop name, home texts and contacts show on every page: expire the cached pages now, not in 30 s.
    await revalidateWeb(rt, ["config", "catalog"], { immediate: true });
    return { ok: true };
  });

  app.get("/v1/admin/categories", { preHandler: guard }, async () => listAdminCategories(rt));
  app.post("/v1/admin/categories", { preHandler: guard }, async (req, reply) => {
    const id = await createManualCategory(rt, ManualCategoryInput.parse(req.body));
    await audit(rt, req.admin!.adminId, "category_create", "category", id);
    return reply.code(201).send({ id });
  });
  app.put("/v1/admin/categories/:id", { preHandler: guard }, async (req) => {
    const id = idParam(req);
    await updateCategory(rt, id, ManualCategoryInput.parse(req.body));
    await audit(rt, req.admin!.adminId, "category_update", "category", id);
    return { ok: true };
  });
  app.delete("/v1/admin/categories/:id", { preHandler: guard }, async (req) => {
    const id = idParam(req);
    const result = await deleteManualCategory(rt, id);
    await audit(rt, req.admin!.adminId, "category_delete", "category", id, result);
    return result;
  });
  app.put("/v1/admin/categories/:id/i18n", { preHandler: guard }, async (req) => {
    const id = z.uuid().parse((req.params as { id: string }).id);
    const body = z.object({ uz: z.string().max(120).default(""), ru: z.string().max(120).default("") }).parse(req.body);
    for (const locale of ["uz", "ru"] as const) {
      const name = body[locale].trim();
      if (!name) await rt.db.delete(categoryI18n).where(and(eq(categoryI18n.categoryId, id), eq(categoryI18n.locale, locale)));
      else await rt.db.insert(categoryI18n).values({ categoryId: id, locale, name }).onConflictDoUpdate({ target: [categoryI18n.categoryId, categoryI18n.locale], set: { name } });
    }
    clearCatalogCache();
    await audit(rt, req.admin!.adminId, "category_i18n", "category", id);
    return { ok: true };
  });

  // ------------------------------------------------------------------------------------------ orders
  app.get("/v1/admin/orders", { preHandler: guard }, async (req) => {
    const q = Page.extend({ q: z.string().max(100).optional(), sync: z.enum(["all", "pending_sync", "synced", "failed", "cancelled", "local"]).default("all") }).parse(req.query);
    const where = [];
    if (q.sync !== "all") where.push(eq(orders.syncStatus, q.sync));
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(or(ilike(orders.number, like), ilike(orders.contactPhone, like), ilike(orders.contactName, like))!);
    }
    const cond = where.length ? and(...where) : undefined;
    const rows = await rt.db.select().from(orders).where(cond).orderBy(desc(orders.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ n }] = (await rt.db.select({ n: count() }).from(orders).where(cond)) as [{ n: number }];
    return {
      rows: rows.map((o) => ({
        id: o.id, number: o.number, channel: o.channel, syncStatus: o.syncStatus, msState: o.msState, msStateType: o.msStateType, localStatus: o.localStatus, total: o.total,
        contactName: o.contactName, contactPhone: o.contactPhone, createdAt: o.createdAt, attempts: o.attempts, lastError: o.lastError,
      })),
      total: Number(n),
      page: q.page,
      pageSize: q.pageSize,
    };
  });

  app.get("/v1/admin/orders/:id", { preHandler: guard }, async (req, reply) => {
    const id = z.uuid().parse((req.params as { id: string }).id);
    const [o] = await rt.db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!o) return reply.code(404).send({ error: "not_found" });
    const items = await rt.db.select().from(orderItems).where(eq(orderItems.orderId, id));
    return { ...toOrderView(o, items), msOrderId: o.msOrderId, msOrderName: o.msOrderName, attempts: o.attempts, lastError: o.lastError, telegramId: o.telegramId };
  });

  // The status lives in MoySklad: this writes THROUGH to it (and shows the error if MoySklad refuses), never a local-only status.
  app.post("/v1/admin/orders/:id/state", { preHandler: guard }, async (req, reply) => {
    const id = z.uuid().parse((req.params as { id: string }).id);
    const { stateId } = z.object({ stateId: z.string().min(1) }).parse(req.body);
    try {
      await pushOrderState(rt, id, stateId);
    } catch (err) {
      return reply.code(502).send({ error: "moysklad_failed", message: (err as Error).message });
    }
    await audit(rt, req.admin!.adminId, "order_state", "order", id, { stateId });
    return { ok: true };
  });

  // Orders handled in our admin (no MoySklad, or containing manual products): a fixed status list, told to the customer in their language.
  app.post("/v1/admin/orders/:id/local-status", { preHandler: guard }, async (req) => {
    const id = idParam(req);
    const { status } = z.object({ status: z.enum(LOCAL_ORDER_STATUSES) }).parse(req.body);
    await setLocalOrderStatus(rt, id, status);
    await audit(rt, req.admin!.adminId, "order_local_status", "order", id, { status });
    return { ok: true };
  });

  app.post("/v1/admin/orders/:id/retry", { preHandler: guard }, async (req) => {
    const id = z.uuid().parse((req.params as { id: string }).id);
    await retryOrderPush(rt, id);
    await audit(rt, req.admin!.adminId, "order_retry", "order", id);
    return { ok: true };
  });

  // ------------------------------------------------------------------------------------------ customers, notifications, audit
  app.get("/v1/admin/customers", { preHandler: guard }, async (req) => {
    const q = Page.parse(req.query);
    const rows = await rt.db.select().from(customers).orderBy(desc(customers.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ n }] = (await rt.db.select({ n: count() }).from(customers)) as [{ n: number }];
    return { rows, total: Number(n) };
  });
  app.get("/v1/admin/notifications", { preHandler: guard }, async () => rt.db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(100));
  app.get("/v1/admin/audit", { preHandler: guard }, async () =>
    (await rt.db.execute(sql`SELECT a.id, a.action, a.entity, a.entity_id, a.meta, a.created_at, u.email FROM audit_log a LEFT JOIN admin_users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT 200`)).rows,
  );
  app.get("/v1/admin/webhook-events", { preHandler: guard }, async () => rt.db.select().from(webhookEvents).orderBy(desc(webhookEvents.id)).limit(100));

  // ------------------------------------------------------------------------------------------ Telegram bot
  app.get("/v1/admin/telegram", { preHandler: guard }, async () => {
    const bot = new TelegramApi(rt.env.TELEGRAM_BOT_TOKEN);
    if (!bot.enabled) return { enabled: false, publicUrl: rt.env.PUBLIC_URL, https: rt.env.PUBLIC_URL.startsWith("https://") };
    const [me, hook] = await Promise.all([bot.getMe(), bot.getWebhookInfo()]);
    return { enabled: true, publicUrl: rt.env.PUBLIC_URL, https: rt.env.PUBLIC_URL.startsWith("https://"), me: me.result ?? null, webhook: hook.result ?? null, error: me.ok ? null : me.description };
  });
  app.post("/v1/admin/telegram/setup", { preHandler: guard }, async (req) => {
    const c = await contentMap(rt);
    const report = await setupTelegram({
      token: rt.env.TELEGRAM_BOT_TOKEN,
      publicUrl: rt.env.PUBLIC_URL,
      webhookSecret: rt.env.TELEGRAM_WEBHOOK_SECRET,
      texts: { description: c["bot.description"], shortDescription: c["bot.shortDescription"] },
    });
    await audit(rt, req.admin!.adminId, "telegram_setup", "telegram", null, { ok: report.ok });
    return report;
  });

  void inArray;
  void productImages;
  void categories;
  void products;
  void auditLog;
}
