import { eq, notifications } from "@shop/db";
import type { Runtime } from "./runtime";
import { TelegramApi } from "./telegram";

/** Records a Telegram message and queues it. With no bot token it is stored as "skipped" so the admin can see what WOULD have been sent. */
export async function queueNotification(rt: Runtime, n: { kind: string; chatId: number | null; text: string }): Promise<void> {
  if (n.chatId === null) return;
  const bot = new TelegramApi(rt.env.TELEGRAM_BOT_TOKEN);
  const [row] = await rt.db
    .insert(notifications)
    .values({ kind: n.kind, chatId: n.chatId, text: n.text, status: bot.enabled ? "pending" : "skipped", error: bot.enabled ? null : "no bot token configured" })
    .returning({ id: notifications.id });
  if (bot.enabled && row) await rt.queues.notify.add("send", { notificationId: row.id }, { attempts: 5, backoff: { type: "exponential", delay: 15_000 } });
}

export async function sendNotification(rt: Runtime, id: number): Promise<void> {
  const [row] = await rt.db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  if (!row || row.status === "sent" || row.chatId === null) return;
  const bot = new TelegramApi(rt.env.TELEGRAM_BOT_TOKEN);
  const res = await bot.sendMessage(row.chatId, row.text);
  if (res.ok) {
    await rt.db.update(notifications).set({ status: "sent", sentAt: new Date(), attempts: row.attempts + 1, error: null }).where(eq(notifications.id, id));
    return;
  }
  // 403 = the user blocked the bot / never started it: permanent, do not retry.
  const permanent = res.error_code === 403 || res.error_code === 400;
  await rt.db
    .update(notifications)
    .set({ status: permanent ? "failed" : "pending", attempts: row.attempts + 1, error: res.description ?? "unknown error" })
    .where(eq(notifications.id, id));
  if (!permanent) throw new Error(res.description ?? "telegram send failed");
}
