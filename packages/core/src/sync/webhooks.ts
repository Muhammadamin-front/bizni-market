import { eq, inArray, orders, products, sql, webhookEvents } from "@shop/db";
import { idFromHref, StockWebhookPayload, WebhookPayload } from "@shop/moysklad";
import type { Runtime } from "../runtime";
import { loadSettings } from "../settings";
import { revalidateWeb, withRun, type Trigger } from "./common";
import { applyRemoteOrder } from "./orders";
import { syncFolders, upsertProducts, mappingFrom } from "./catalog";
import { syncStock } from "./stock";

/**
 * MoySklad webhooks are UNSIGNED, retried only three times with no delay, and must be answered in 1.5 s.
 * So the receiver only records what it was told (deduplicated on requestId) and answers; the worker then RE-FETCHES
 * the entities with our own credentials. A forged webhook can therefore at worst cause a harmless refetch.
 */
export async function recordWebhook(rt: Runtime, requestId: string, body: unknown, expectedAccountId?: string): Promise<{ accepted: number }> {
  const stock = StockWebhookPayload.safeParse(body);
  const events = WebhookPayload.safeParse(body);
  const rows: { requestId: string; entityType: string; action: string; href: string | null }[] = [];

  if (events.success && events.data.events.length > 0) {
    for (const e of events.data.events) {
      if (expectedAccountId && e.accountId && e.accountId !== expectedAccountId) continue;
      rows.push({ requestId, entityType: e.meta.type ?? "unknown", action: e.action, href: e.meta.href });
    }
  } else if (stock.success && stock.data.reportUrl) {
    rows.push({ requestId, entityType: "stock", action: "UPDATE", href: null });
  }
  if (rows.length === 0) return { accepted: 0 };

  const inserted = await rt.db.insert(webhookEvents).values(rows).onConflictDoNothing().returning({ id: webhookEvents.id });
  if (inserted.length) await rt.queues.sync.add("webhooks", { trigger: "webhook" }, { jobId: "webhooks-waiting", delay: 10_000, removeOnComplete: true, removeOnFail: true }); // coalesce a burst for ~10 s
  return { accepted: inserted.length };
}

export async function processWebhookEvents(rt: Runtime, trigger: Trigger): Promise<void> {
  await withRun(rt, "webhooks", trigger, async (counts) => {
    const pending = await rt.db.select().from(webhookEvents).where(eq(webhookEvents.status, "received")).orderBy(webhookEvents.id).limit(1000);
    if (pending.length === 0) return;
    const s = await loadSettings(rt);

    const productIds = new Set<string>();
    const orderIds = new Set<string>();
    let foldersChanged = false;
    let stockChanged = false;
    for (const e of pending) {
      const id = e.href ? idFromHref(e.href) : "";
      if (e.entityType === "product" && id) productIds.add(id);
      else if (e.entityType === "productfolder") foldersChanged = true;
      else if (e.entityType === "customerorder" && id) orderIds.add(id);
      else if (e.entityType === "stock") stockChanged = true;
    }

    if (foldersChanged) await syncFolders(rt, "webhook");
    if (productIds.size) {
      const fetched = await rt.ms!.productsByIds([...productIds], mappingFrom(s), "background");
      await upsertProducts(rt, fetched, s, { initialImport: false }, counts);
      // Deleted products can no longer be fetched by id: hide the ones MoySklad did not return.
      const returned = new Set(fetched.map((p) => p.msId));
      const missing = [...productIds].filter((id) => !returned.has(id));
      if (missing.length) await rt.db.update(products).set({ archived: true }).where(inArray(products.msId, missing));
      counts.products = productIds.size;
    }
    if (stockChanged) await syncStock(rt, "webhook", "changed");

    // Only orders we created are interesting: staff create plenty of others in MoySklad.
    if (orderIds.size) {
      const ours = await rt.db.select({ msOrderId: orders.msOrderId }).from(orders).where(inArray(orders.msOrderId, [...orderIds]));
      for (const row of ours) {
        if (!row.msOrderId) continue;
        const remote = await rt.ms!.getOrder(row.msOrderId, "background");
        if (await applyRemoteOrder(rt, remote)) counts.orders = (counts.orders ?? 0) + 1;
      }
    }

    await rt.db
      .update(webhookEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(inArray(webhookEvents.id, pending.map((p) => p.id)));
    counts.events = pending.length;
    if (productIds.size || foldersChanged) await revalidateWeb(rt);
  });
}

/** Daily: MoySklad silently disables webhooks whose receiver kept failing. Make sure ours exist and are enabled. */
export async function ensureWebhooks(rt: Runtime, trigger: Trigger): Promise<{ registered: number; enabled: number; skipped?: string }> {
  const result = { registered: 0, enabled: 0 } as { registered: number; enabled: number; skipped?: string };
  await withRun(rt, "webhook_health", trigger, async (counts) => {
    const base = rt.env.webhookBaseUrl;
    if (!rt.env.MOYSKLAD_WEBHOOK_SECRET) {
      result.skipped = "MOYSKLAD_WEBHOOK_SECRET is not set: polling only";
      return;
    }
    if (!/^https:\/\//.test(base) && !rt.demo) {
      result.skipped = "PUBLIC_URL is not https: MoySklad cannot call it; polling only";
      return;
    }
    const url = `${base}/api/webhooks/ms/${rt.env.MOYSKLAD_WEBHOOK_SECRET}`;
    if (url.length > 255) throw new Error("webhook URL is longer than MoySklad's 255 character limit");

    const wanted: { entityType: string; action: "CREATE" | "UPDATE" | "DELETE" }[] = [
      { entityType: "product", action: "CREATE" }, { entityType: "product", action: "UPDATE" }, { entityType: "product", action: "DELETE" },
      { entityType: "productfolder", action: "CREATE" }, { entityType: "productfolder", action: "UPDATE" }, { entityType: "productfolder", action: "DELETE" },
      { entityType: "customerorder", action: "UPDATE" },
    ];
    try {
      const existing = await rt.ms!.webhooks();
      for (const w of wanted) {
        const found = existing.find((e) => e.url.startsWith(url) && e.entityType === w.entityType && e.action === w.action);
        if (!found) {
          await rt.ms!.createWebhook({ url, ...w });
          result.registered++;
        } else if (found.enabled === false) {
          await rt.ms!.enableWebhook(found.id);
          result.enabled++;
        }
      }
      const stockHooks = await rt.ms!.stockWebhooks();
      if (!stockHooks.some((h) => h.url.startsWith(url))) {
        await rt.ms!.createStockWebhook({ url, stockType: "stock", reportType: "all" });
        result.registered++;
      }
    } catch (err) {
      // Free tariffs cannot create webhooks. That is fine: polling runs the whole system by itself.
      result.skipped = `webhooks unavailable: ${(err as Error).message}`;
      return;
    }
    counts.registered = result.registered;
    counts.enabled = result.enabled;
  });
  return result;
}

export { sql };
