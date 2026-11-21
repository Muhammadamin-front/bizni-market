import { createHash } from "node:crypto";
import { eq, orderItems, orders } from "@shop/db";
import { CircuitOpenError, MoySkladAmbiguousError, type RawCustomerOrder } from "@shop/moysklad";
import { enqueueOrderPush } from "../queues";
import type { Runtime } from "../runtime";
import { autoConfigure, loadSettings } from "../settings";
import { getOrderStates } from "../sync/orders";

/** Deterministic UUID for "the counterparty the site created for this phone", so a returning customer re-attaches to the same one. */
export function counterpartySyncId(phone: string): string {
  const h = createHash("sha1").update(`shop-counterparty:${phone}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class OrderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderConfigError";
  }
}

const idFromHref = (href?: string) => href?.split("?")[0]?.split("/").filter(Boolean).pop() ?? "";

export type PushOutcome = "created" | "adopted" | "noop";

/**
 * Sends one order to MoySklad exactly once.
 * - `ms_sync_id` was generated when the order was saved, BEFORE the first call. Every attempt starts by looking the order up by it,
 *   so a lost response, a timeout or a crash between "created" and "saved" can never produce a second order.
 * - Counterparty matching is a setting. Default ("site-only"): a guest's unverified phone number is never attached to a counterparty staff created.
 */
export async function pushOrder(rt: Runtime, orderId: string): Promise<PushOutcome> {
  const [order] = await rt.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.syncStatus === "synced" || order.syncStatus === "cancelled" || order.syncStatus === "local") return "noop";

  await rt.db.update(orders).set({ attempts: order.attempts + 1, updatedAt: new Date() }).where(eq(orders.id, orderId));
  try {
    if (!rt.ms) throw new OrderConfigError("MoySklad is not connected (MOYSKLAD_TOKEN is empty); the order will be sent once it is.");
    let settings = await loadSettings(rt);
    if (!settings.organizationId) settings = (await autoConfigure(rt))?.settings ?? settings;
    if (!settings.organizationId) throw new OrderConfigError("Order organisation is not configured (Admin → Settings).");

    // 1. Did a previous attempt already create it?
    const existing = await rt.ms.findOrderBySyncId(order.msSyncId);
    if (existing) {
      await finalize(rt, orderId, existing);
      return "adopted";
    }

    // 2. Counterparty
    const items = await rt.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const cpSyncId = counterpartySyncId(order.contactPhone);
    let counterpartyId = (await rt.ms.findCounterpartyBySyncId(cpSyncId))?.id ?? "";
    let possibleMatchNote = "";
    const byPhone = await rt.ms.findCounterpartyByPhone(order.contactPhone);
    if (!counterpartyId && settings.counterpartyMatching === "trust-phone" && byPhone[0]) counterpartyId = byPhone[0].id;
    if (!counterpartyId && byPhone[0]) possibleMatchNote = `\nEhtimol mavjud kontragent: ${byPhone[0].name ?? byPhone[0].id} (avtomatik ulanmadi)`;
    if (!counterpartyId) {
      counterpartyId = (
        await rt.ms.createCounterparty({
          name: order.contactName,
          phone: order.contactPhone,
          address: order.address,
          syncId: cpSyncId,
          tags: ["web-unverified"],
          description: "Sayt orqali yaratilgan, tasdiqlanmagan kontragent",
        })
      ).id;
    }

    // 3. Create the order
    const reserve = order.channel === "tma" ? settings.reserveOnCreateTma : settings.reserveOnCreateWeb;
    const prefix = order.channel === "tma" ? settings.orderPrefixTma : settings.orderPrefixWeb;
    const description = [
      `[${order.channel === "tma" ? "Telegram" : "Sayt"}] ${order.contactName}, ${order.contactPhone}`,
      order.deliveryMethod === "pickup" ? "Olib ketish" : "Yetkazib berish",
      order.comment ? `Izoh: ${order.comment}` : "",
      `Buyurtma ${order.number}`,
    ]
      .filter(Boolean)
      .join("\n")
      .concat(possibleMatchNote)
      .slice(0, 4000);

    const input = {
      organizationId: settings.organizationId,
      counterpartyId,
      storeId: settings.orderStoreId || undefined,
      salesChannelId: settings.salesChannelId || undefined,
      stateId: settings.initialStateId || undefined,
      name: order.number || `${prefix}${order.seq}`,
      externalCode: order.number,
      syncId: order.msSyncId,
      description,
      shipmentAddress: (order.deliveryMethod === "pickup" ? "Olib ketish" : order.address).slice(0, 255),
      positions: items.map((i) => ({ productMsId: i.msProductId, unitPrice: i.unitPrice, quantity: i.quantity, reserve: reserve ? i.quantity : undefined })),
      // Our own writes must not echo back as webhooks.
      disableWebhooksByPrefix: rt.env.webhookBaseUrl,
    };

    let created: RawCustomerOrder;
    try {
      created = await rt.ms.createOrder(input);
    } catch (err) {
      if (err instanceof MoySkladAmbiguousError) {
        // The request may have been processed. Look before anything else retries.
        const found = await rt.ms.findOrderBySyncId(order.msSyncId);
        if (found) {
          await finalize(rt, orderId, found);
          return "adopted";
        }
      }
      throw err;
    }
    await finalize(rt, orderId, created);
    return "created";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await rt.db.update(orders).set({ lastError: message.slice(0, 1000), updatedAt: new Date() }).where(eq(orders.id, orderId));
    throw err;
  }
}

async function finalize(rt: Runtime, orderId: string, remote: RawCustomerOrder): Promise<void> {
  const states = await getOrderStates(rt).catch(() => []);
  const stateId = remote.state?.id ?? idFromHref(remote.state?.meta?.href);
  const state = states.find((s) => s.id === stateId);
  await rt.db
    .update(orders)
    .set({
      syncStatus: "synced",
      msOrderId: remote.id,
      msOrderName: remote.name ?? null,
      msState: remote.state?.name ?? state?.name ?? null,
      msStateType: remote.state?.stateType ?? state?.stateType ?? null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));
}

export async function markOrderFailed(rt: Runtime, orderId: string, message: string): Promise<void> {
  await rt.db.update(orders).set({ syncStatus: "failed", lastError: message.slice(0, 1000), updatedAt: new Date() }).where(eq(orders.id, orderId));
}

/** Admin "retry": clears the failure and queues a fresh push (the lookup-by-syncId step keeps it duplicate-safe). */
export async function retryOrderPush(rt: Runtime, orderId: string): Promise<void> {
  const [order] = await rt.db.select({ syncStatus: orders.syncStatus }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.syncStatus === "local") return; // handled in our admin, never sent
  await rt.db.update(orders).set({ syncStatus: "pending_sync", attempts: 0, lastError: null, updatedAt: new Date() }).where(eq(orders.id, orderId));
  const job = await rt.queues.orders.getJob(`push-${orderId}`);
  await job?.remove().catch(() => undefined);
  await enqueueOrderPush(rt.queues, orderId);
}

/** Safety net: any order still pending after a couple of minutes without a live job gets one (e.g. Redis was down at checkout). */
export async function sweepPendingOrders(rt: Runtime): Promise<number> {
  const cutoff = new Date(Date.now() - 2 * 60_000);
  const stuck = await rt.db.select({ id: orders.id, createdAt: orders.createdAt }).from(orders).where(eq(orders.syncStatus, "pending_sync"));
  let queued = 0;
  for (const o of stuck) {
    if (o.createdAt > cutoff) continue;
    const job = await rt.queues.orders.getJob(`push-${o.id}`);
    if (job) continue;
    await enqueueOrderPush(rt.queues, o.id);
    queued++;
  }
  return queued;
}

/** Applies an admin's status change in MoySklad (the single source of truth for statuses). */
export async function pushOrderState(rt: Runtime, orderId: string, stateId: string): Promise<void> {
  const [order] = await rt.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order?.msOrderId) throw new Error("Order has not reached MoySklad yet");
  if (!rt.ms) throw new OrderConfigError("MoySklad is not connected");
  const remote = await rt.ms.setOrderState(order.msOrderId, stateId, rt.env.webhookBaseUrl);
  const states = await getOrderStates(rt);
  const state = states.find((s) => s.id === stateId);
  await rt.db
    .update(orders)
    .set({ msState: remote.state?.name ?? state?.name ?? order.msState, msStateType: state?.stateType ?? order.msStateType, updatedAt: new Date() })
    .where(eq(orders.id, orderId));
}

export { CircuitOpenError };
