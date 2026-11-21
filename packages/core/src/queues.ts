import { Queue } from "bullmq";
import { redisOptions } from "./runtime";

export const QUEUE = {
  sync: "sync",
  orders: "orders",
  notify: "notify",
  /** Image downloads can run for many minutes; they get their own queue so stock and product sync never wait behind them. */
  media: "media",
} as const;

export type SyncJobName = "full" | "folders" | "products" | "stock" | "stock-full" | "images" | "reconcile" | "webhook-health" | "order-states" | "webhooks" | "sweep-orders";
export type OrderJobName = "push" | "state-push";

export interface SyncJobData {
  trigger: "schedule" | "manual" | "webhook" | "boot";
}
export interface OrderPushData {
  orderId: string;
}
export interface StatePushData {
  orderId: string;
  stateId: string;
  adminId?: string;
}
export interface NotifyData {
  notificationId: number;
}

export interface Queues {
  sync: Queue;
  orders: Queue;
  notify: Queue;
  media: Queue;
  close(): Promise<void>;
}

const defaultJobOptions = { removeOnComplete: { count: 200 }, removeOnFail: { count: 500 } };

export function createQueues(redisUrl: string): Queues {
  const connection = redisOptions(redisUrl);
  const sync = new Queue(QUEUE.sync, { connection, defaultJobOptions });
  const orders = new Queue(QUEUE.orders, { connection, defaultJobOptions });
  const notify = new Queue(QUEUE.notify, { connection, defaultJobOptions });
  const media = new Queue(QUEUE.media, { connection, defaultJobOptions });
  return {
    sync,
    orders,
    notify,
    media,
    async close() {
      await Promise.all([sync.close(), orders.close(), notify.close(), media.close()]);
    },
  };
}

/** Queue a sync job with a stable id, so repeated triggers (a burst of webhooks, a double click) collapse into one waiting job. */
export async function enqueueSync(queues: Queues, name: SyncJobName, trigger: SyncJobData["trigger"], delayMs = 0) {
  // The id dedupes while the job waits or runs; it is removed afterwards so the next trigger is accepted (outcomes live in sync_runs).
  const queue = name === "images" ? queues.media : queues.sync;
  await queue.add(name, { trigger } satisfies SyncJobData, { jobId: `${name}-waiting`, delay: delayMs, removeOnComplete: true, removeOnFail: true });
}

export async function enqueueOrderPush(queues: Queues, orderId: string, delayMs = 0) {
  await queues.orders.add("push", { orderId } satisfies OrderPushData, {
    jobId: `push-${orderId}`,
    delay: delayMs,
    attempts: 10,
    backoff: { type: "exponential", delay: 30_000 },
    // The job id must be reusable (admin "retry"); the outcome lives in the orders table.
    removeOnComplete: true,
    removeOnFail: true,
  });
}

export async function enqueueStatePush(queues: Queues, data: StatePushData) {
  await queues.orders.add("state-push", data, { attempts: 6, backoff: { type: "exponential", delay: 20_000 } });
}
