import { createHash } from "node:crypto";
import { and, customers, eq, gte, inArray, orderItems, orders, productOverlays, products, sql } from "@shop/db";
import { formatAmount, type CheckoutInput, type OrderChannel, type OrderView } from "@shop/shared";
import { queueNotification } from "../notify";
import { enqueueOrderPush } from "../queues";
import type { Runtime } from "../runtime";
import { loadSettings } from "../settings";
import { texts } from "../texts";
import { loadOrderView } from "./view";

export class OrderError extends Error {
  constructor(
    readonly code: "invalid_lines" | "below_minimum" | "rate_limited" | "challenge_failed" | "idempotency_conflict" | "empty_catalog",
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = "OrderError";
  }
}

export interface LineProblem {
  productId: string;
  reason: "unavailable" | "insufficient_stock" | "invalid_step";
  available?: number;
  step?: number;
}

export interface CreateOrderContext {
  channel: OrderChannel;
  customerId: string | null;
  telegramId: number | null;
  ip: string;
  idempotencyKey: string;
}

/** Per-IP and per-phone ceilings. Guest checkout is open to the internet: these are what stop a script from flooding MoySklad. */
export const ORDER_LIMITS = { perIpPer10Min: 8, perPhonePerHour: 5 };

async function hit(rt: Runtime, key: string, ttlSeconds: number, max: number): Promise<boolean> {
  const n = await rt.redis.incr(key);
  if (n === 1) await rt.redis.expire(key, ttlSeconds);
  return n <= max;
}

export async function verifyTurnstile(rt: Runtime, token: string | undefined, ip: string): Promise<boolean> {
  if (!rt.env.TURNSTILE_SECRET) return true; // not configured: honeypot + rate limits still apply
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: rt.env.TURNSTILE_SECRET, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return false; // fail closed
  }
}

const roundQty = (n: number) => Math.round(n * 1000) / 1000;

export async function createOrder(rt: Runtime, input: CheckoutInput, ctx: CreateOrderContext): Promise<{ order: OrderView; created: boolean }> {
  // 1. Idempotency: a double click or a retry returns the same order instead of making another.
  const [dupe] = await rt.db.select().from(orders).where(eq(orders.idempotencyKey, ctx.idempotencyKey)).limit(1);
  if (dupe) {
    if (dupe.contactPhone !== input.phone) throw new OrderError("idempotency_conflict", 422);
    return { order: (await loadOrderView(rt, eq(orders.id, dupe.id)))!, created: false };
  }

  // 2. Abuse limits
  const ipHash = createHash("sha256").update(ctx.ip + rt.env.SESSION_SECRET).digest("hex").slice(0, 16);
  if (!(await hit(rt, `rl:order:ip:${ipHash}`, 600, ORDER_LIMITS.perIpPer10Min)) || !(await hit(rt, `rl:order:phone:${input.phone}`, 3600, ORDER_LIMITS.perPhonePerHour))) {
    throw new OrderError("rate_limited", 429);
  }
  if (ctx.channel === "web" && !(await verifyTurnstile(rt, input.turnstileToken, ctx.ip))) throw new OrderError("challenge_failed", 400);

  // 3. Re-price and re-check stock from OUR read model. The client's idea of price or stock is never trusted.
  const merged = new Map<string, number>();
  for (const line of input.items) merged.set(line.productId, roundQty((merged.get(line.productId) ?? 0) + line.quantity));
  const rows = await rt.db
    .select({ p: products })
    .from(products)
    .leftJoin(productOverlays, eq(productOverlays.productId, products.id))
    .where(and(inArray(products.id, [...merged.keys()]), eq(products.archived, false), sql`${products.price} > 0`, sql`COALESCE(${productOverlays.hidden}, false) = false`));
  const byId = new Map(rows.map((r) => [r.p.id, r.p]));

  const problems: LineProblem[] = [];
  const lines: { p: typeof products.$inferSelect; qty: number }[] = [];
  for (const [productId, qty] of merged) {
    const p = byId.get(productId);
    if (!p) {
      problems.push({ productId, reason: "unavailable" });
      continue;
    }
    const step = p.qtyStep;
    const steps = qty / step;
    if (qty < step - 1e-9 || Math.abs(steps - Math.round(steps)) > 1e-6) problems.push({ productId, reason: "invalid_step", step });
    else if (qty > p.availableQty + 1e-9) problems.push({ productId, reason: "insufficient_stock", available: p.availableQty });
    else lines.push({ p, qty });
  }
  if (problems.length) throw new OrderError("invalid_lines", 409, problems);

  const settings = await loadSettings(rt);
  const total = lines.reduce((sum, l) => sum + Math.round(l.p.price * l.qty), 0);
  // Handled in our own admin when there is no MoySklad to send it to, or when it holds products MoySklad does not know.
  const local = !rt.ms || lines.some((l) => l.p.source === "manual");
  if (total < settings.minimumOrderAmount) throw new OrderError("below_minimum", 422, { minimum: settings.minimumOrderAmount, total });

  // 4. One transaction: order + snapshot lines. The idempotency key is unique, so a race between two identical submits cannot create two.
  const prefix = ctx.channel === "tma" ? settings.orderPrefixTma : settings.orderPrefixWeb;
  let orderId: string;
  try {
    orderId = await rt.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(orders)
        .values({
          channel: ctx.channel,
          customerId: ctx.customerId,
          telegramId: ctx.telegramId,
          idempotencyKey: ctx.idempotencyKey,
          syncStatus: local ? "local" : "pending_sync",
          localStatus: local ? "new" : null,
          total,
          contactName: input.name,
          contactPhone: input.phone,
          deliveryMethod: input.deliveryMethod,
          address: input.deliveryMethod === "pickup" ? "" : input.address,
          comment: input.comment,
          language: input.language,
          ipHash,
        })
        .returning({ id: orders.id, seq: orders.seq });
      await tx.update(orders).set({ number: `${prefix}${created!.seq}` }).where(eq(orders.id, created!.id));
      await tx.insert(orderItems).values(
        lines.map((l) => ({
          orderId: created!.id,
          productId: l.p.id,
          msProductId: l.p.source === "manual" ? "" : l.p.msId,
          name: l.p.name,
          article: l.p.article,
          unit: l.p.uom,
          unitPrice: l.p.price,
          quantity: l.qty,
          lineTotal: Math.round(l.p.price * l.qty),
        })),
      );
      await tx.update(products).set({ popularity: sql`${products.popularity} + 1` }).where(inArray(products.id, lines.map((l) => l.p.id)));
      // Manual products keep their stock here (MoySklad keeps its own): take the units now, atomically, so two buyers cannot get the last one.
      for (const l of lines.filter((x) => x.p.source === "manual")) {
        const took = await tx
          .update(products)
          .set({ availableQty: sql`${products.availableQty} - ${l.qty}` })
          .where(and(eq(products.id, l.p.id), sql`${products.availableQty} >= ${l.qty}`))
          .returning({ id: products.id });
        if (took.length === 0) {
          const [now] = await tx.select({ q: products.availableQty }).from(products).where(eq(products.id, l.p.id));
          throw new OrderError("invalid_lines", 409, [{ productId: l.p.id, reason: "insufficient_stock", available: now?.q ?? 0 } satisfies LineProblem]);
        }
      }
      if (ctx.customerId) await tx.update(customers).set({ phone: input.phone, name: input.name }).where(eq(customers.id, ctx.customerId));
      return created!.id;
    });
  } catch (err) {
    if (err instanceof OrderError) throw err;
    // Lost the race against an identical submit: return that order.
    const [again] = await rt.db.select().from(orders).where(eq(orders.idempotencyKey, ctx.idempotencyKey)).limit(1);
    if (again) return { order: (await loadOrderView(rt, eq(orders.id, again.id)))!, created: false };
    throw err;
  }

  // 5. After commit: hand to the worker. If Redis is down the sweeper picks the order up, so the customer is never blocked.
  //    A locally handled order is not sent anywhere: staff see it in the admin (and in the staff chat below).
  if (!local) {
    try {
      await enqueueOrderPush(rt.queues, orderId);
    } catch (err) {
      rt.log.error({ err: (err as Error).message, orderId }, "could not enqueue order push; the sweeper will retry");
    }
  }

  const view = (await loadOrderView(rt, eq(orders.id, orderId)))!;
  await queueNotification(rt, { kind: "order_status", chatId: ctx.telegramId, text: texts.orderReceived(input.language, view.number, total) });
  for (const chatId of settings.staffChatIds) {
    await queueNotification(rt, {
      kind: "staff_new_order",
      chatId,
      text: texts.staffNewOrder({
        number: view.number,
        channel: ctx.channel === "tma" ? "Telegram" : "Sayt",
        name: input.name,
        phone: input.phone,
        total,
        delivery: input.deliveryMethod === "delivery",
        address: input.address,
        comment: input.comment,
        items: lines.slice(0, 20).map((l) => ({ name: l.p.name, qty: l.qty, sum: Math.round(l.p.price * l.qty) })),
      }),
    });
  }
  return { order: view, created: true };
}

export { formatAmount, gte };
