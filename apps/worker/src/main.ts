import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, type Job } from "bullmq";
import {
  QUEUE, autoConfigure, bootstrapAdmin, createRuntime, ensureWebhooks, enqueueSync, fullSync, loadEnv, loadSettings, markOrderFailed, pollOrderStates, processWebhookEvents, pushOrder, pushOrderState,
  queueNotification, reconcileProducts, redisOptions, sendNotification, sweepPendingOrders, syncFolders, syncImages, syncProducts, syncStock, texts,
  type NotifyData, type OrderPushData, type StatePushData, type SyncJobData,
} from "@shop/core";
import { runMigrations, syncRuns, sql } from "@shop/db";

const env = loadEnv();
// The breaker hook needs the runtime to notify staff, so it is filled in right after creation.
let alertStaff: (text: string) => void = () => undefined;
const rt = createRuntime(env, "worker", {
  onBreakerOpen: (until, failures) => alertStaff(`MoySklad bilan aloqa vaqtincha toʻxtatildi (${failures} xato). Qayta urinish: ${new Date(until).toISOString()}`),
});
alertStaff = (text) => {
  void (async () => {
    const settings = await loadSettings(rt);
    for (const chatId of settings.staffChatIds) await queueNotification(rt, { kind: "sync_alert", chatId, text: texts.syncAlert(text) });
  })().catch(() => undefined);
};

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = [path.resolve(here, "../drizzle"), path.resolve(here, "../../../packages/db/drizzle"), path.resolve(process.cwd(), "drizzle")].find((p) => existsSync(path.join(p, "meta/_journal.json")));
if (!migrations) throw new Error("migrations folder not found");
await runMigrations(rt.pool, migrations);
await bootstrapAdmin(rt);

const connection = redisOptions(env.REDIS_URL);

// Resolve the unambiguous defaults (price type, organisation, brand attribute...) BEFORE the first scheduled sync maps anything.
if (rt.ms) await autoConfigure(rt).catch((err) => rt.log.warn({ err: (err as Error).message }, "auto-configuration failed; the owner can set these in the admin"));

// ------------------------------------------------------------------------------------------------ workers
const syncWorker = new Worker<SyncJobData>(
  QUEUE.sync,
  async (job: Job<SyncJobData>) => {
    const trigger = job.data.trigger ?? "schedule";
    switch (job.name) {
      case "full": return void (await fullSync(rt, trigger));
      case "folders": return void (await syncFolders(rt, trigger));
      case "products": return void (await syncProducts(rt, trigger, "incremental"));
      case "stock": return void (await syncStock(rt, trigger, "changed"));
      case "stock-full": return void (await syncStock(rt, trigger, "full"));
      case "reconcile": return void (await reconcileProducts(rt, trigger));
      case "webhook-health": return void (await ensureWebhooks(rt, trigger));
      case "order-states": return void (await pollOrderStates(rt, trigger));
      case "webhooks": return void (await processWebhookEvents(rt, trigger));
      case "sweep-orders": return void (await sweepPendingOrders(rt));
      default: rt.log.warn({ name: job.name }, "unknown sync job");
    }
  },
  { connection, concurrency: 1 },
);

const mediaWorker = new Worker<SyncJobData>(QUEUE.media, async (job) => void (await syncImages(rt, job.data.trigger ?? "schedule")), { connection, concurrency: 1 });

const ordersWorker = new Worker<OrderPushData | StatePushData>(
  QUEUE.orders,
  async (job) => {
    if (job.name === "push") {
      const outcome = await pushOrder(rt, (job.data as OrderPushData).orderId);
      rt.log.info({ orderId: (job.data as OrderPushData).orderId, outcome }, "order push");
      return;
    }
    if (job.name === "state-push") {
      const d = job.data as StatePushData;
      await pushOrderState(rt, d.orderId, d.stateId);
    }
  },
  { connection, concurrency: 2 },
);
ordersWorker.on("failed", (job, err) => {
  if (!job) return;
  const attempts = job.opts.attempts ?? 1;
  rt.log.warn({ job: job.name, attempt: job.attemptsMade, of: attempts, err: err.message }, "order job failed");
  // Out of attempts: stop retrying, show it in the admin "failed orders" list, and tell the staff. The admin can retry with one click.
  if (job.name === "push" && job.attemptsMade >= attempts) {
    const orderId = (job.data as OrderPushData).orderId;
    void markOrderFailed(rt, orderId, err.message).then(() => alertStaff(`Buyurtma MoySkladga yuborilmadi (${attempts} urinishdan keyin): ${err.message}`));
  }
});

const notifyWorker = new Worker<NotifyData>(QUEUE.notify, async (job) => sendNotification(rt, job.data.notificationId), { connection, concurrency: 3 });

for (const w of [syncWorker, mediaWorker, ordersWorker, notifyWorker]) w.on("error", (err) => rt.log.error({ err: err.message }, "worker error"));

// ------------------------------------------------------------------------------------------------ schedule
// Polling is the baseline that keeps the system correct even when no webhook ever arrives. Webhooks only reduce the delay.
const every = (minutes: number) => ({ every: minutes * 60_000 });
const schedules: { id: string; repeat: { every: number } | { pattern: string }; name: string }[] = [
  { id: "products", repeat: every(5), name: "products" },
  { id: "stock", repeat: every(3), name: "stock" },
  { id: "folders", repeat: every(30), name: "folders" },
  { id: "order-states", repeat: every(2), name: "order-states" },
  { id: "sweep-orders", repeat: every(2), name: "sweep-orders" },
  { id: "stock-full", repeat: { pattern: "30 3 * * *" }, name: "stock-full" },
  { id: "reconcile", repeat: { pattern: "0 4 * * *" }, name: "reconcile" },
  { id: "webhook-health", repeat: { pattern: "15 4 * * *" }, name: "webhook-health" },
];
await rt.queues.media.upsertJobScheduler("images", every(10), { name: "images", data: { trigger: "schedule" }, opts: { removeOnComplete: true, removeOnFail: true } });
for (const s of schedules) {
  await rt.queues.sync.upsertJobScheduler(s.id, s.repeat, { name: s.name, data: { trigger: "schedule" }, opts: { removeOnComplete: true, removeOnFail: true } });
}

// First boot: nothing synced yet -> do the full sync now, so the catalogue appears without anyone clicking.
if (env.SYNC_ON_BOOT && rt.ms) {
  const [row] = (await rt.db.execute(sql`SELECT count(*)::int AS n FROM ${syncRuns} WHERE kind = 'full' AND status = 'ok'`)).rows as { n: number }[];
  if (!row || row.n === 0) {
    rt.log.info("no completed full sync yet: starting one");
    await enqueueSync(rt.queues, "full", "boot");
  }
}
rt.log.info({ moysklad: rt.ms ? env.MOYSKLAD_BASE_URL : "not connected (MOYSKLAD_TOKEN empty)", demo: rt.demo }, "worker started");

const shutdown = async (signal: string) => {
  rt.log.info({ signal }, "worker shutting down");
  await Promise.all([syncWorker.close(), mediaWorker.close(), ordersWorker.close(), notifyWorker.close()]);
  await rt.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
