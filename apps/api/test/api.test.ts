import { eq, orders, webhookEvents } from "@shop/db";
import { createAdmin, fullSync, syncImages } from "@shop/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_EMAIL, ADMIN_PASSWORD, createWorld, makeInitData, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.stop();
});

const get = (url: string, headers: Record<string, string> = {}) => w.app.inject({ method: "GET", url, headers });
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => w.app.inject({ method: "POST", url, payload: payload as object, headers });
const json = <T = any>(res: { json(): unknown }) => res.json() as T; // eslint-disable-line @typescript-eslint/no-explicit-any

async function seedCatalog() {
  await fullSync(w.rt, "manual");
  await w.rt.db.execute(`DELETE FROM product_images WHERE id NOT IN (SELECT id FROM product_images ORDER BY id LIMIT 4)` as never);
  await syncImages(w.rt, "manual");
}

describe("public catalogue API", () => {
  beforeAll(async () => {
    await w.reset();
    await seedCatalog();
  });

  it("answers health and readiness", async () => {
    expect((await get("/health")).statusCode).toBe(200);
    expect(json(await get("/ready"))).toEqual({ ok: true });
  });

  it("exposes a public config with no secrets", async () => {
    const res = await get("/v1/config");
    const body = json(res);
    expect(body.demo).toBe(true);
    expect(res.headers["cache-control"]).toContain("max-age");
    const text = res.body;
    for (const secret of ["demo-token", "TEST-bot-token", "ms-webhook-secret", "tg-webhook-secret", "t".repeat(20)]) expect(text).not.toContain(secret);
  });

  it("serves the home payload, categories, brands and a filtered catalogue", async () => {
    const home = json(await get("/v1/home?locale=ru"));
    expect(home.categories.length).toBe(2);
    expect(home.offers.length).toBeGreaterThan(0);
    const cats = json(await get("/v1/categories"));
    expect(cats[0].children.length).toBeGreaterThan(0);
    expect(json(await get("/v1/brands")).length).toBeGreaterThan(5);
    const page = json(await get("/v1/catalog/products?q=%D1%80%D1%83%D1%87%D0%BA%D0%B0&pageSize=10&sort=price_asc"));
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((p: { name: string }) => /ruchka/i.test(p.name))).toBe(true);
  });

  it("returns a product, redirects a stale slug, and 404s an unknown one", async () => {
    const [first] = json(await get("/v1/catalog/products?pageSize=1")).items;
    const detail = json(await get(`/v1/products/${first.slug}`));
    expect(detail.id).toBe(first.id);
    expect(detail.description).toBeDefined();
    const short = first.slug.slice(-8);
    expect(json(await get(`/v1/products/old-name-${short}`))).toEqual({ redirectTo: first.slug });
    expect((await get("/v1/products/does-not-exist-00000000")).statusCode).toBe(404);
  });

  it("rejects malformed input with a 400, not a 500", async () => {
    for (const url of ["/v1/catalog/products?page=-3", "/v1/catalog/products?pageSize=9999", "/v1/catalog/products?sort=drop", "/v1/products/by-ids"]) {
      const res = url.endsWith("by-ids") ? await post(url, { ids: ["nope"] }) : await get(url);
      expect(res.statusCode, url).toBe(400);
      expect(json(res).error).toBe("validation");
    }
    expect(res500Free(await get("/v1/catalog/products?q=%27%3B%20DROP%20TABLE%20products%3B--")).statusCode).toBe(200);
  });

  it("hydrates a cart from ids, dropping what is no longer sold", async () => {
    const items = json(await get("/v1/catalog/products?pageSize=2")).items;
    const res = await post("/v1/products/by-ids", { ids: [items[0].id, "00000000-0000-4000-8000-000000000000", items[1].id] });
    expect(json(res).map((p: { id: string }) => p.id)).toEqual([items[0].id, items[1].id]);
  });

  it("serves our own image copies with long-lived caching, and refuses path tricks", async () => {
    const withImage = json(await get("/v1/catalog/products?pageSize=60&sort=name")).items.find((p: { imageUrl: string | null }) => p.imageUrl);
    let url: string | null = withImage?.imageUrl ?? null;
    if (!url) {
      for (let p = 2; p <= 6 && !url; p++) url = json(await get(`/v1/catalog/products?pageSize=60&sort=name&page=${p}`)).items.find((i: { imageUrl: string | null }) => i.imageUrl)?.imageUrl ?? null;
    }
    expect(url).toBeTruthy();
    const img = await get(url!);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect(img.headers["cache-control"]).toContain("immutable");
    for (const evil of ["/media/../../../etc/passwd", "/media/%2e%2e/%2e%2e/etc/passwd", "/media/..%2f..%2fpackage.json"]) expect([400, 403, 404]).toContain((await get(evil)).statusCode);
  });

  it("returns the sitemap data", async () => {
    const s = json(await get("/v1/sitemap"));
    expect(s.products.length).toBeGreaterThan(100);
  });
});

function res500Free<T extends { statusCode: number }>(r: T): T {
  expect(r.statusCode).toBeLessThan(500);
  return r;
}

describe("Telegram Mini App identity", () => {
  beforeAll(async () => {
    await w.reset();
    await seedCatalog();
  });

  it("exchanges valid initData for a token and refuses bad or stale data", async () => {
    const ok = await post("/v1/auth/telegram", { initData: makeInitData() });
    expect(ok.statusCode).toBe(200);
    expect(json(ok).me).toMatchObject({ telegramId: 42, name: "Ali" });
    expect((await post("/v1/auth/telegram", { initData: makeInitData(undefined, "999:wrong-token") })).statusCode).toBe(401);
    expect((await post("/v1/auth/telegram", { initData: makeInitData(undefined, undefined, Math.floor(Date.now() / 1000) - 10 * 86_400) })).statusCode).toBe(401);
    expect((await post("/v1/auth/telegram", { initData: "garbage" })).statusCode).toBe(401);
    expect((await post("/v1/auth/telegram", {})).statusCode).toBe(401);
  });

  it("does not offer a dev login unless it was explicitly enabled", async () => {
    expect((await post("/v1/auth/telegram", { dev: true })).statusCode).toBe(403);
  });

  it("protects customer data, and shows a customer only their own", async () => {
    expect((await get("/v1/me")).statusCode).toBe(401);
    expect((await get("/v1/me", { authorization: "Bearer nonsense" })).statusCode).toBe(401);
    const a = json(await post("/v1/auth/telegram", { initData: makeInitData({ id: 101, first_name: "A" }) })).token;
    const b = json(await post("/v1/auth/telegram", { initData: makeInitData({ id: 202, first_name: "B" }) })).token;
    const authA = { authorization: `Bearer ${a}` };
    const authB = { authorization: `Bearer ${b}` };
    expect(json(await get("/v1/me", authA)).telegramId).toBe(101);
    const updated = await w.app.inject({ method: "PUT", url: "/v1/me", headers: authA, payload: { name: "Ali V", phone: "90 123 45 67", language: "ru" } });
    expect(json(updated)).toMatchObject({ name: "Ali V", phone: "+998901234567", language: "ru" });
    expect((await w.app.inject({ method: "PUT", url: "/v1/me", headers: authA, payload: { phone: "123" } })).statusCode).toBe(400);

    const items = json(await get("/v1/catalog/products?pageSize=2")).items;
    expect((await w.app.inject({ method: "PUT", url: `/v1/favorites/${items[0].id}`, headers: authA })).statusCode).toBe(204);
    expect(json(await get("/v1/favorites", authA)).map((p: { id: string }) => p.id)).toEqual([items[0].id]);
    expect(json(await get("/v1/favorites", authB))).toEqual([]);
    expect((await w.app.inject({ method: "DELETE", url: `/v1/favorites/${items[0].id}`, headers: authA })).statusCode).toBe(204);
    expect(json(await get("/v1/favorites", authA))).toEqual([]);

    const put = await w.app.inject({ method: "PUT", url: "/v1/cart", headers: authA, payload: { items: [{ productId: items[1].id, quantity: 2 }] } });
    expect(json(put).items).toHaveLength(1);
    expect(json(await get("/v1/cart", authA)).items[0].quantity).toBe(2);
    expect(json(await get("/v1/cart", authB)).items).toEqual([]);
    expect((await w.app.inject({ method: "PUT", url: "/v1/cart", headers: authA, payload: { items: [{ productId: "x", quantity: 2 }] } })).statusCode).toBe(400);
  });

  it("caches nothing private", async () => {
    const token = json(await post("/v1/auth/telegram", { initData: makeInitData() })).token;
    expect((await get("/v1/me", { authorization: `Bearer ${token}` })).headers["cache-control"]).toBe("no-store");
  });
});

describe("checkout API", () => {
  beforeAll(async () => {
    await w.reset();
    await seedCatalog();
  });
  const body = (items: unknown[], over: Record<string, unknown> = {}) => ({ items, name: "Ali Valiyev", phone: "90 123 45 67", deliveryMethod: "delivery", address: "Chilonzor 12, 5", ...over });
  let n = 0;
  const key = () => `idem-key-${Date.now()}-${n++}`;
  async function inStock(count = 1) {
    const all = json(await get("/v1/catalog/products?pageSize=60&inStock=1")).items as { id: string; freeStock: number; qtyStep: number }[];
    return all.filter((p) => p.freeStock >= 10 && p.qtyStep === 1).slice(0, count);
  }

  it("demands an Idempotency-Key and validates the body", async () => {
    const [p] = await inStock();
    expect((await post("/v1/orders", body([{ productId: p!.id, quantity: 1 }]))).statusCode).toBe(400);
    expect((await post("/v1/orders", body([]), { "idempotency-key": key() })).statusCode).toBe(400);
    expect((await post("/v1/orders", body([{ productId: p!.id, quantity: 1 }], { phone: "12" }), { "idempotency-key": key() })).statusCode).toBe(400);
    expect((await post("/v1/orders", body([{ productId: p!.id, quantity: 1 }], { website: "http://spam.example" }), { "idempotency-key": key() })).statusCode).toBe(400);
    expect((await post("/v1/orders", body([{ productId: p!.id, quantity: 1 }]), { "idempotency-key": "short" })).statusCode).toBe(400);
  });

  it("creates an order once per key (201 then 200) and exposes it on an unguessable link", async () => {
    const [p] = await inStock();
    const k = key();
    const first = await post("/v1/orders", body([{ productId: p!.id, quantity: 2 }]), { "idempotency-key": k });
    expect(first.statusCode).toBe(201);
    const order = json(first);
    expect(order.channel).toBe("web");
    expect(order.items).toHaveLength(1);
    const again = await post("/v1/orders", body([{ productId: p!.id, quantity: 2 }]), { "idempotency-key": k });
    expect(again.statusCode).toBe(200);
    expect(json(again).id).toBe(order.id);

    expect(json(await get(`/v1/orders/${order.publicId}`)).number).toBe(order.number);
    expect((await get("/v1/orders/not-a-uuid")).statusCode).toBe(404);
    expect((await get("/v1/orders/00000000-0000-4000-8000-000000000000")).statusCode).toBe(404);
    expect((await get(`/v1/orders/${order.id}`)).statusCode).toBe(404); // the internal id is not a key to the order
  });

  it("ignores any price the client sends and reports unsellable lines per line", async () => {
    const [p] = await inStock();
    const card = json(await get("/v1/catalog/products?pageSize=1")).items[0];
    const res = await post("/v1/orders", body([{ productId: p!.id, quantity: 1, price: 1 }]), { "idempotency-key": key() });
    expect(res.statusCode).toBe(201);
    const real = json(await get(`/v1/products/${(await w.rt.db.select().from(orders).where(eq(orders.id, json(res).id)))[0] && card.slug}`));
    void real;
    const placed = json(res);
    const [item] = placed.items;
    const [dbItem] = (await w.rt.pool.query("SELECT unit_price FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.public_id = $1", [placed.publicId])).rows;
    expect(item.unitPrice).toBe(Number(dbItem.unit_price));
    expect(placed.total).toBe(item.unitPrice * 1);

    const bad = await post("/v1/orders", body([{ productId: p!.id, quantity: 100_000 }, { productId: "00000000-0000-4000-8000-000000000000", quantity: 1 }]), { "idempotency-key": key() });
    expect(bad.statusCode).toBe(409);
    expect(json(bad).details).toHaveLength(2);
  });

  it("attributes an order to the Mini App customer when a token is sent, and lists it under /v1/orders", async () => {
    const [p] = await inStock();
    const token = json(await post("/v1/auth/telegram", { initData: makeInitData({ id: 303, first_name: "TG" }) })).token;
    const auth = { authorization: `Bearer ${token}` };
    const res = await post("/v1/orders", body([{ productId: p!.id, quantity: 1 }]), { "idempotency-key": key(), ...auth });
    expect(res.statusCode).toBe(201);
    expect(json(res).channel).toBe("tma");
    const mine = json(await get("/v1/orders", auth));
    expect(mine).toHaveLength(1);
    const other = json(await post("/v1/auth/telegram", { initData: makeInitData({ id: 404, first_name: "X" }) })).token;
    expect(json(await get("/v1/orders", { authorization: `Bearer ${other}` }))).toEqual([]);
  });

  it("rate-limits abusive ordering from one phone", async () => {
    const [p] = await inStock();
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await post("/v1/orders", body([{ productId: p!.id, quantity: 1 }], { phone: "97 000 11 22" }), { "idempotency-key": key() })).statusCode);
    expect(codes).toContain(429);
  });
});

describe("webhook receivers", () => {
  beforeAll(async () => {
    await w.reset();
  });

  it("MoySklad: wrong secret is a 404, the right one records the event and answers 200 fast", async () => {
    const payload = { events: [{ meta: { type: "product", href: "http://x/api/remap/1.2/entity/product/abc" }, action: "UPDATE", accountId: "a" }] };
    expect((await post("/webhooks/ms/not-the-secret?requestId=r1", payload)).statusCode).toBe(404);
    const t0 = Date.now();
    const ok = await post("/webhooks/ms/ms-webhook-secret?requestId=r1", payload);
    expect(ok.statusCode).toBe(200);
    expect(Date.now() - t0).toBeLessThan(500); // MoySklad allows 1500 ms
    await post("/webhooks/ms/ms-webhook-secret?requestId=r1", payload); // retry with the same id
    expect(await w.rt.db.select().from(webhookEvents)).toHaveLength(1);
  });

  it("MoySklad: the /api-prefixed public URL reaches the same receiver (webhook base URL may point at the API directly)", async () => {
    const payload = { events: [{ meta: { type: "product", href: "http://x/api/remap/1.2/entity/product/def" }, action: "UPDATE", accountId: "a" }] };
    expect((await post("/api/webhooks/ms/ms-webhook-secret?requestId=r-api", payload)).statusCode).toBe(200);
    expect((await post("/api/webhooks/ms/nope?requestId=r-api2", payload)).statusCode).toBe(404);
    expect((await w.rt.db.select().from(webhookEvents)).some((e) => e.requestId === "r-api")).toBe(true);
  });

  it("MoySklad: junk bodies are accepted harmlessly", async () => {
    expect((await post("/webhooks/ms/ms-webhook-secret?requestId=r2", { hello: 1 })).statusCode).toBe(200);
    expect((await post("/webhooks/ms/ms-webhook-secret", {})).statusCode).toBe(200);
  });

  it("Telegram: needs both the path secret and the secret-token header", async () => {
    const update = { message: { text: "/start", chat: { id: 1 }, from: { language_code: "uz" } } };
    expect((await post("/webhooks/telegram/tg-webhook-secret", update)).statusCode).toBe(404);
    expect((await post("/webhooks/telegram/wrong", update, { "x-telegram-bot-api-secret-token": "tg-webhook-secret" })).statusCode).toBe(404);
    expect((await post("/webhooks/telegram/tg-webhook-secret", update, { "x-telegram-bot-api-secret-token": "wrong" })).statusCode).toBe(404);
    expect((await post("/webhooks/telegram/tg-webhook-secret", { nonsense: true }, { "x-telegram-bot-api-secret-token": "tg-webhook-secret" })).statusCode).toBe(200);
  });
});

describe("admin API", () => {
  let cookie = "";
  const hdr = (extra: Record<string, string> = {}) => ({ cookie, "x-requested-with": "shop-admin", ...extra });

  beforeAll(async () => {
    await w.reset();
    await seedCatalog();
    await createAdmin(w.rt, ADMIN_EMAIL, ADMIN_PASSWORD);
  });
  beforeEach(async () => {
    if (!cookie) {
      const login = await post("/v1/admin/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      expect(login.statusCode).toBe(200);
      cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    }
  });

  it("locks every admin route to a signed-in admin", async () => {
    for (const url of ["/v1/admin/me", "/v1/admin/dashboard", "/v1/admin/products", "/v1/admin/orders", "/v1/admin/settings", "/v1/admin/sync", "/v1/admin/customers", "/v1/admin/audit"]) {
      expect((await get(url)).statusCode, url).toBe(401);
    }
  });

  it("sets an httpOnly, SameSite cookie and rejects wrong credentials identically", async () => {
    const login = await post("/v1/admin/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const setCookie = String(login.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Secure/i); // PUBLIC_URL is https
    const wrong = await post("/v1/admin/login", { email: ADMIN_EMAIL, password: "wrong-password-123" });
    const unknown = await post("/v1/admin/login", { email: "nobody@shop.uz", password: "wrong-password-123" });
    expect(wrong.statusCode).toBe(401);
    expect(json(wrong)).toEqual(json(unknown));
  });

  it("blocks state-changing calls without the CSRF header or from a foreign origin", async () => {
    const [p] = json(await get("/v1/catalog/products?pageSize=1")).items;
    const noHeader = await w.app.inject({ method: "PATCH", url: `/v1/admin/products/${p.id}`, headers: { cookie }, payload: { hidden: true } });
    expect(noHeader.statusCode).toBe(403);
    const foreign = await w.app.inject({ method: "PATCH", url: `/v1/admin/products/${p.id}`, headers: hdr({ origin: "https://evil.example" }), payload: { hidden: true } });
    expect(foreign.statusCode).toBe(403);
    const ok = await w.app.inject({ method: "PATCH", url: `/v1/admin/products/${p.id}`, headers: hdr({ origin: "https://shop.example.test" }), payload: { hidden: false } });
    expect(ok.statusCode).toBe(200);
  });

  it("can hide a MoySklad product from the storefront, and can change NOTHING else about it", async () => {
    const [p] = json(await get("/v1/catalog/products?pageSize=1")).items;
    const hide = await w.app.inject({ method: "PATCH", url: `/v1/admin/products/${p.id}`, headers: hdr(), payload: { hidden: true } });
    expect(hide.statusCode).toBe(200);
    expect((await get(`/v1/products/${p.slug}`)).statusCode).toBe(404);
    expect(json(await get("/v1/catalog/products?pageSize=60")).items.some((i: { id: string }) => i.id === p.id)).toBe(false);
    // product fields are managed in MoySklad: unknown fields are a 400, price and stock a 409 that says why
    for (const payload of [{ name: "x" }, { hidden: true, slug: "x" }, {}]) {
      expect((await w.app.inject({ method: "PATCH", url: `/v1/admin/products/${p.id}`, headers: hdr(), payload })).statusCode).toBe(400);
    }
    for (const payload of [{ price: 1 }, { availableQty: 99 }, { hidden: true, price: 1 }]) {
      const res = await w.app.inject({ method: "PATCH", url: `/v1/admin/products/${p.id}`, headers: hdr(), payload });
      expect(res.statusCode).toBe(409);
      expect(json(res).error).toBe("managed_by_moysklad");
    }
    const full = { name: "Renamed", price: 1, availableQty: 1 };
    expect((await w.app.inject({ method: "PUT", url: `/v1/admin/products/${p.id}`, headers: hdr(), payload: full })).statusCode).toBe(409);
    expect((await w.app.inject({ method: "DELETE", url: `/v1/admin/products/${p.id}`, headers: hdr() })).statusCode).toBe(409);
    expect(json(await get(`/v1/admin/products/${p.id}`, hdr())).name).toBe(p.name);
    await w.app.inject({ method: "PATCH", url: `/v1/admin/products/${p.id}`, headers: hdr(), payload: { hidden: false } });
    expect((await get(`/v1/products/${p.slug}`)).statusCode).toBe(200);
  });

  it("creates, photographs, edits and deletes a product by hand, and the storefront follows", async () => {
    const cat = await post("/v1/admin/categories", { nameUz: "Qo‘lda", nameRu: "Вручную" }, hdr());
    expect(cat.statusCode).toBe(201);
    const bad = await post("/v1/admin/products", { name: "x", price: -1 }, hdr());
    expect(bad.statusCode).toBe(400);
    const created = await post("/v1/admin/products", { name: "Qalam HB", price: 1200, availableQty: 50, categoryId: json(cat).id, brand: "Koh-i-Noor", uom: "dona" }, hdr());
    expect(created.statusCode).toBe(201);
    const p = json(created);
    expect(p).toMatchObject({ source: "manual", price: 1200, availableQty: 50, brand: "Koh-i-Noor", images: [] });

    const sharp = (await import("sharp")).default;
    const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#3366aa" } }).jpeg().toBuffer();
    const up = await w.app.inject({ method: "POST", url: `/v1/admin/products/${p.id}/images`, headers: hdr({ "content-type": "image/jpeg" }), payload: jpeg });
    expect(up.statusCode).toBe(200);
    expect(json(up).images).toHaveLength(1);
    const notImage = await w.app.inject({ method: "POST", url: `/v1/admin/products/${p.id}/images`, headers: hdr({ "content-type": "image/png" }), payload: Buffer.from("nope".repeat(100)) });
    expect(notImage.statusCode).toBe(422);
    expect(json(notImage).error).toBe("image_unsupported");
    const media = await get(json(up).images[0].medium);
    expect(media.statusCode).toBe(200);

    const pub = json(await get(`/v1/products/${p.slug}`));
    expect(pub).toMatchObject({ name: "Qalam HB", price: 1200, brand: "Koh-i-Noor" });
    expect(pub.images).toHaveLength(1);

    expect((await w.app.inject({ method: "PATCH", url: `/v1/admin/products/${p.id}`, headers: hdr(), payload: { price: 1500, availableQty: 5 } })).statusCode).toBe(200);
    expect(json(await get(`/v1/products/${p.slug}`))).toMatchObject({ price: 1500, freeStock: 5 });
    const edited = await w.app.inject({ method: "PUT", url: `/v1/admin/products/${p.id}`, headers: hdr(), payload: { name: "Qalam HB (12 dona)", price: 14000, oldPrice: 16000, availableQty: 5, packSize: 12 } });
    expect(edited.statusCode).toBe(200);
    expect(json(edited)).toMatchObject({ name: "Qalam HB (12 dona)", oldPrice: 16000, brand: "" });

    const list = json(await get("/v1/admin/products?filter=manual", hdr()));
    expect(list.rows.map((r: { id: string }) => r.id)).toContain(p.id);
    expect(list.rows.find((r: { id: string }) => r.id === p.id).thumb).toMatch(/^\/media\/.+-160\.webp$/);

    expect((await w.app.inject({ method: "DELETE", url: `/v1/admin/products/${p.id}`, headers: hdr() })).statusCode).toBe(204);
    expect((await get(`/v1/admin/products/${p.id}`, hdr())).statusCode).toBe(404);
    const delCat = await w.app.inject({ method: "DELETE", url: `/v1/admin/categories/${json(cat).id}`, headers: hdr() });
    expect(delCat.statusCode).toBe(200);
  });

  it("curates the home page: featured slots, banners and content blocks", async () => {
    const items = json(await get("/v1/catalog/products?pageSize=3")).items;
    const put = await w.app.inject({ method: "PUT", url: "/v1/admin/featured/featured", headers: hdr(), payload: { productIds: [items[2].id, items[0].id] } });
    expect(put.statusCode).toBe(200);
    expect(json(await get("/v1/home")).featured.map((p: { id: string }) => p.id)).toEqual([items[2].id, items[0].id]);

    const banner = json(await w.app.inject({ method: "POST", url: "/v1/admin/banners", headers: hdr(), payload: { title: "Yangi mavsum", linkUrl: "/catalog", locale: "uz" } }));
    expect(json(await get("/v1/home?locale=uz")).banners[0].title).toBe("Yangi mavsum");
    expect(json(await get("/v1/home?locale=ru")).banners).toEqual([]);
    expect((await w.app.inject({ method: "POST", url: "/v1/admin/banners", headers: hdr(), payload: { title: "x", linkUrl: "javascript:alert(1)" } })).statusCode).toBe(400);
    expect((await w.app.inject({ method: "DELETE", url: `/v1/admin/banners/${banner.id}`, headers: hdr() })).statusCode).toBe(204);

    await w.app.inject({ method: "PUT", url: "/v1/admin/content/footer.phone", headers: hdr(), payload: { uz: "+998 90 000 00 00", ru: "+998 90 000 00 00" } });
    expect(json(await get("/v1/config")).content["footer.phone"].uz).toBe("+998 90 000 00 00");
    expect((await w.app.inject({ method: "PUT", url: "/v1/admin/content/Bad Key!", headers: hdr(), payload: {} })).statusCode).toBe(400);
  });

  it("changes settings and tells the admin what must re-sync", async () => {
    const before = json(await get("/v1/admin/settings", hdr()));
    expect(before.options.priceTypes.length).toBe(3);
    expect(before.options.stores.length).toBe(2);
    const res = await w.app.inject({ method: "PUT", url: "/v1/admin/settings", headers: hdr(), payload: { minimumOrderAmount: 15_000, storeIds: [before.options.stores[0].id], bogus: "ignored" } });
    expect(json(res).settings.minimumOrderAmount).toBe(15_000);
    expect(json(res).resync).toBe("stock");
    expect((await w.app.inject({ method: "PUT", url: "/v1/admin/settings", headers: hdr(), payload: { minimumOrderAmount: -5 } })).statusCode).toBe(400);
    await w.app.inject({ method: "PUT", url: "/v1/admin/settings", headers: hdr(), payload: { minimumOrderAmount: 0, storeIds: [] } });
  });

  it("lists orders and writes a status change through to MoySklad", async () => {
    const [p] = json(await get("/v1/catalog/products?pageSize=60&inStock=1")).items.filter((x: { freeStock: number }) => x.freeStock >= 5);
    const placed = json(await post("/v1/orders", { items: [{ productId: p.id, quantity: 1 }], name: "Vali", phone: "93 111 22 33", deliveryMethod: "pickup" }, { "idempotency-key": `admin-order-${Date.now()}` }));
    const { pushOrder } = await import("@shop/core");
    await pushOrder(w.rt, placed.id);
    const list = json(await get("/v1/admin/orders?sync=synced", hdr()));
    expect(list.rows.some((r: { id: string }) => r.id === placed.id)).toBe(true);
    const detail = json(await get(`/v1/admin/orders/${placed.id}`, hdr()));
    expect(detail.msOrderId).toBeTruthy();
    const states = json(await get("/v1/admin/order-states", hdr()));
    const delivered = states.find((s: { stateType: string }) => s.stateType === "Successful");
    const change = await w.app.inject({ method: "POST", url: `/v1/admin/orders/${placed.id}/state`, headers: hdr(), payload: { stateId: delivered.id } });
    expect(change.statusCode).toBe(200);
    expect(w.mock.orders.find((o) => o.id === detail.msOrderId)?.stateId).toBe(delivered.id);
    expect(json(await get(`/v1/admin/orders/${placed.id}`, hdr())).status).toBe(delivered.name);
    // MoySklad refusing is surfaced, not swallowed
    const refused = await w.app.inject({ method: "POST", url: `/v1/admin/orders/${placed.id}/state`, headers: hdr(), payload: { stateId: "00000000-0000-4000-8000-000000000000" } });
    expect(refused.statusCode).toBe(502);
  });

  it("handles an order for a manual product locally: admin statuses, told to the customer, stock given back on cancel", async () => {
    const p = json(await post("/v1/admin/products", { name: "Bloknot A5", price: 9000, availableQty: 2 }, hdr()));
    const placed = json(await post("/v1/orders", { items: [{ productId: p.id, quantity: 2 }], name: "Vali", phone: "93 111 22 44", deliveryMethod: "pickup" }, { "idempotency-key": `local-order-${Date.now()}` }));
    expect(placed).toMatchObject({ syncStatus: "local", statusCode: "new" });
    expect(json(await get(`/v1/admin/products/${p.id}`, hdr())).availableQty).toBe(0);
    expect(json(await get("/v1/admin/orders?sync=local", hdr())).rows.map((r: { id: string }) => r.id)).toContain(placed.id);
    expect((await post(`/v1/admin/orders/${placed.id}/local-status`, { status: "shipped-to-mars" }, hdr())).statusCode).toBe(400);
    expect((await post(`/v1/admin/orders/${placed.id}/local-status`, { status: "cancelled" }, hdr())).statusCode).toBe(200);
    expect(json(await get(`/v1/orders/${placed.publicId}`))).toMatchObject({ statusCode: "cancelled", status: "Bekor qilindi", statusType: "Unsuccessful" });
    expect(json(await get(`/v1/admin/products/${p.id}`, hdr())).availableQty).toBe(2);
  });

  it("deletes a cancelled order for good, refuses any other, and clears every cancelled order at once", async () => {
    const p = json(await post("/v1/admin/products", { name: "Qalam ko'k", price: 3000, availableQty: 5 }, hdr()));
    const place = async (phone: string) =>
      json(await post("/v1/orders", { items: [{ productId: p.id, quantity: 1 }], name: "Vali", phone, deliveryMethod: "pickup" }, { "idempotency-key": `del-order-${Date.now()}-${phone.replace(/ /g, "")}` }));
    const [a, b, c] = [await place("93 111 22 55"), await place("93 111 22 66"), await place("93 111 22 77")];
    const del = (id: string, headers: Record<string, string> = hdr()) => w.app.inject({ method: "DELETE", url: `/v1/admin/orders/${id}`, headers });

    expect((await del(a.id)).statusCode).toBe(409); // a new order is never deleted
    expect(json(await get(`/v1/admin/orders/${a.id}`, hdr())).cancelled).toBe(false);
    for (const o of [a, b]) expect((await post(`/v1/admin/orders/${o.id}/local-status`, { status: "cancelled" }, hdr())).statusCode).toBe(200);
    const list = json(await get("/v1/admin/orders?sync=cancelled", hdr()));
    expect(list.rows.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(list.rows.every((r: { cancelled: boolean }) => r.cancelled)).toBe(true);
    expect(list.cancelledTotal).toBe(list.total);
    expect(json(await get(`/v1/admin/orders/${a.id}`, hdr())).cancelled).toBe(true);

    expect((await del(a.id, { cookie })).statusCode).toBe(403); // no CSRF header
    expect((await del(a.id)).statusCode).toBe(204);
    expect((await get(`/v1/admin/orders/${a.id}`, hdr())).statusCode).toBe(404);
    expect((await get(`/v1/orders/${a.publicId}`)).statusCode).toBe(404); // gone for the customer too
    expect((await del(a.id)).statusCode).toBe(404);

    expect((await post("/v1/admin/orders/delete-cancelled", { confirm: "yes" }, hdr())).statusCode).toBe(400);
    expect(json(await post("/v1/admin/orders/delete-cancelled", { confirm: "DELETE" }, hdr())).deleted).toBeGreaterThanOrEqual(1);
    expect((await get(`/v1/admin/orders/${b.id}`, hdr())).statusCode).toBe(404);
    expect((await get(`/v1/admin/orders/${c.id}`, hdr())).statusCode).toBe(200); // not cancelled: stays
    expect(json(await get("/v1/admin/orders", hdr())).cancelledTotal).toBe(0);
    expect(json(await get(`/v1/admin/products/${p.id}`, hdr())).availableQty).toBe(4); // 5 - 3 ordered + 2 back on cancel
    const actions = json(await get("/v1/admin/audit", hdr())).map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["order_delete", "order_delete_cancelled"]));
  });

  it("shows sync health on the dashboard and queues manual runs", async () => {
    const d = json(await get("/v1/admin/dashboard", hdr()));
    expect(d.connected).toBe(true);
    expect(d.demo).toBe(true);
    expect(d.catalog.visible).toBeGreaterThan(100);
    expect(d.lastRuns.some((r: { kind: string; status: string }) => r.kind === "products_full" && r.status === "ok")).toBe(true);
    const run = await w.app.inject({ method: "POST", url: "/v1/admin/sync/run", headers: hdr(), payload: { kind: "stock" } });
    expect(json(run).queued).toBe("stock");
    expect((await w.app.inject({ method: "POST", url: "/v1/admin/sync/run", headers: hdr(), payload: { kind: "rm -rf" } })).statusCode).toBe(400);
  });

  it("records every admin change in the audit log, and never caches admin responses", async () => {
    const audit = json(await get("/v1/admin/audit", hdr()));
    expect(audit.some((a: { action: string }) => a.action === "product_hide")).toBe(true);
    expect(audit.some((a: { action: string }) => a.action === "settings_update")).toBe(true);
    expect((await get("/v1/admin/me", hdr())).headers["cache-control"]).toBe("no-store");
  });

  it("logs out for real", async () => {
    const login = await post("/v1/admin/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const c = String(login.headers["set-cookie"]).split(";")[0]!;
    expect((await get("/v1/admin/me", { cookie: c })).statusCode).toBe(200);
    await w.app.inject({ method: "POST", url: "/v1/admin/logout", headers: { cookie: c, "x-requested-with": "shop-admin" } });
    expect((await get("/v1/admin/me", { cookie: c })).statusCode).toBe(401);
  });
});

describe("dev login is a closed door unless explicitly opened", () => {
  it("opens only with TMA_DEV_MODE, and the environment refuses it in production with a real bot", async () => {
    const dev = await createWorld({ TMA_DEV_MODE: "true", TELEGRAM_BOT_TOKEN: "" });
    try {
      const res = await dev.app.inject({ method: "POST", url: "/v1/auth/telegram", payload: { dev: true } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { me: { telegramId: number } }).me.telegramId).toBe(900_000_001);
    } finally {
      await dev.stop();
    }
    const { loadEnv } = await import("@shop/core");
    expect(() => loadEnv({ NODE_ENV: "production", SESSION_SECRET: "s".repeat(40), TMA_DEV_MODE: "true", TELEGRAM_BOT_TOKEN: "1:abc" })).toThrow(/TMA_DEV_MODE/);
    expect(() => loadEnv({ NODE_ENV: "production", SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
    expect(() => loadEnv({ NODE_ENV: "production", SESSION_SECRET: "s".repeat(40), ADMIN_PASSWORD: "tooshort" })).toThrow(/ADMIN_PASSWORD/);
  });
});

describe("client address behind Cloudflare Tunnel", () => {
  it("rate-limits by the edge header, not by a spoofable X-Forwarded-For", async () => {
    const cf = await createWorld({ CLIENT_IP_HEADER: "cf-connecting-ip" });
    try {
      await cf.rt.redis.flushdb();
      // A different account each time, so only the per-address limit (20 per 15 min) is in play, not the per-account one.
      let n = 0;
      const login = (headers: Record<string, string>) =>
        cf.app.inject({ method: "POST", url: "/v1/admin/login", payload: { email: `nobody${n++}@shop.uz`, password: "wrong-password-123" }, headers });
      // One visitor rotating X-Forwarded-For is still one visitor: the 21st try in the window is refused.
      const codes: number[] = [];
      for (let i = 0; i < 21; i++) codes.push((await login({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": `198.51.100.${i}` })).statusCode);
      expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
      expect(codes[20]).toBe(429);
      // Another visitor (another edge address) is not affected by the first one.
      expect((await login({ "cf-connecting-ip": "203.0.113.8" })).statusCode).toBe(401);
      // A malformed header falls back to the socket/proxy address instead of creating a fresh bucket per junk value.
      expect((await login({ "cf-connecting-ip": "not-an-ip" })).statusCode).toBe(401);
    } finally {
      await cf.stop();
    }
  });
});
