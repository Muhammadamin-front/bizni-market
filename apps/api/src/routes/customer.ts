import { carts, customers, eq, favorites, and, orders, desc, productOverlays } from "@shop/db";
import { productsByIds, signTmaToken, toOrderView, upsertTelegramCustomer, validateInitData, type Runtime } from "@shop/core";
import { orderItems } from "@shop/db";
import { normalizePhone, type MeView } from "@shop/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { limitBy, requireTma } from "../guards";

/** Stand-in identity for opening the Mini App in a plain browser. Only reachable when TMA_DEV_MODE is on (refused at boot in production with a real bot). */
const DEV_USER = { id: 900_000_001, first_name: "Demo", last_name: "Foydalanuvchi", username: "demo_user", language_code: "uz" };

async function meView(rt: Runtime, customerId: string): Promise<MeView | null> {
  const [c] = await rt.db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!c) return null;
  return { id: c.id, name: c.name, phone: c.phone, language: c.language === "ru" ? "ru" : "uz", telegramId: c.telegramId, username: c.username };
}

export function customerRoutes(app: FastifyInstance, rt: Runtime) {
  const auth = requireTma(rt);

  app.post("/v1/auth/telegram", { preHandler: limitBy(rt, "auth", 30, 60) }, async (req, reply) => {
    const body = z.object({ initData: z.string().max(4096).optional(), dev: z.boolean().optional() }).parse(req.body);
    let user: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string };

    if (body.dev) {
      if (!rt.env.TMA_DEV_MODE) return reply.code(403).send({ error: "dev_mode_disabled" });
      user = DEV_USER;
    } else {
      const result = validateInitData(body.initData ?? "", rt.env.TELEGRAM_BOT_TOKEN, rt.env.TELEGRAM_INITDATA_MAX_AGE);
      if (!result.ok) return reply.code(401).send({ error: "invalid_init_data", reason: result.reason });
      user = result.user;
    }
    const customerId = await upsertTelegramCustomer(rt, user);
    const token = signTmaToken(rt.env.SESSION_SECRET, { cid: customerId, tg: user.id });
    return { token, me: await meView(rt, customerId) };
  });

  app.get("/v1/me", { preHandler: auth }, async (req, reply) => (await meView(rt, req.tma!.cid)) ?? reply.code(404).send({ error: "not_found" }));

  app.put("/v1/me", { preHandler: auth }, async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        phone: z.string().trim().refine((v) => normalizePhone(v) !== null).transform((v) => normalizePhone(v) as string).optional(),
        language: z.enum(["uz", "ru"]).optional(),
      })
      .parse(req.body);
    await rt.db.update(customers).set(body).where(eq(customers.id, req.tma!.cid));
    return meView(rt, req.tma!.cid);
  });

  // ---- favourites
  app.get("/v1/favorites", { preHandler: auth }, async (req) => {
    const rows = await rt.db.select({ productId: favorites.productId }).from(favorites).where(eq(favorites.customerId, req.tma!.cid)).orderBy(desc(favorites.createdAt));
    const { locale } = z.object({ locale: z.enum(["uz", "ru"]).default("uz") }).parse(req.query);
    return productsByIds(rt, rows.map((r) => r.productId), locale);
  });
  app.get("/v1/favorites/ids", { preHandler: auth }, async (req) =>
    (await rt.db.select({ productId: favorites.productId }).from(favorites).where(eq(favorites.customerId, req.tma!.cid))).map((r) => r.productId),
  );
  app.put("/v1/favorites/:productId", { preHandler: auth }, async (req, reply) => {
    const productId = z.uuid().parse((req.params as { productId: string }).productId);
    await rt.db.insert(favorites).values({ customerId: req.tma!.cid, productId }).onConflictDoNothing();
    return reply.code(204).send();
  });
  app.delete("/v1/favorites/:productId", { preHandler: auth }, async (req, reply) => {
    const productId = z.uuid().parse((req.params as { productId: string }).productId);
    await rt.db.delete(favorites).where(and(eq(favorites.customerId, req.tma!.cid), eq(favorites.productId, productId)));
    return reply.code(204).send();
  });

  // ---- cart (server copy for the Mini App, so it follows the customer between devices)
  const CartBody = z.object({ items: z.array(z.object({ productId: z.uuid(), quantity: z.number().positive().max(100_000) })).max(100) });
  app.get("/v1/cart", { preHandler: auth }, async (req) => {
    const [row] = await rt.db.select().from(carts).where(eq(carts.customerId, req.tma!.cid)).limit(1);
    return { items: row?.items ?? [] };
  });
  app.put("/v1/cart", { preHandler: auth }, async (req) => {
    const { items } = CartBody.parse(req.body);
    await rt.db
      .insert(carts)
      .values({ customerId: req.tma!.cid, items, updatedAt: new Date() })
      .onConflictDoUpdate({ target: carts.customerId, set: { items, updatedAt: new Date() } });
    return { items };
  });

  // ---- my orders
  app.get("/v1/orders", { preHandler: auth }, async (req) => {
    const list = await rt.db.select().from(orders).where(eq(orders.customerId, req.tma!.cid)).orderBy(desc(orders.createdAt)).limit(50);
    const out = [];
    for (const o of list) out.push(toOrderView(o, await rt.db.select().from(orderItems).where(eq(orderItems.orderId, o.id))));
    return out;
  });
}

export { productOverlays };
