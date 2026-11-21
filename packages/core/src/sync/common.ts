import { desc, eq, syncRuns } from "@shop/db";
import { queueNotification } from "../notify";
import { loadSettings } from "../settings";
import { texts } from "../texts";
import type { Runtime } from "../runtime";

export type Trigger = "schedule" | "manual" | "webhook" | "boot";
export type Counts = Record<string, number>;

/** SET NX PX lock so two workers never run the same sync at once. */
export async function withLock<T>(rt: Pick<Runtime, "redis">, key: string, ttlMs: number, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const token = `${process.pid}:${Date.now()}`;
  const ok = await rt.redis.set(`lock:${key}`, token, "PX", ttlMs, "NX");
  if (ok !== "OK") return { ran: false };
  try {
    return { ran: true, value: await fn() };
  } finally {
    const current = await rt.redis.get(`lock:${key}`);
    if (current === token) await rt.redis.del(`lock:${key}`);
  }
}

/**
 * Wraps a sync job: single-flight lock, a sync_runs row, error capture. Returns undefined when it was skipped
 * (no MoySklad token, another run in progress) or failed; failures are recorded, never thrown, because a sync that
 * fails must not crash the worker and the next scheduled run is the retry.
 */
export async function withRun<T>(rt: Runtime, kind: string, trigger: Trigger, fn: (counts: Counts) => Promise<T>, opts: { lockTtlMs?: number } = {}): Promise<T | undefined> {
  if (!rt.ms) {
    rt.log.debug({ kind }, "skipping sync: MOYSKLAD_TOKEN is not set");
    return undefined;
  }
  const locked = await withLock(rt, `sync:${kind}`, opts.lockTtlMs ?? 20 * 60_000, async () => {
    const [run] = await rt.db.insert(syncRuns).values({ kind, status: "running", trigger }).returning({ id: syncRuns.id });
    const counts: Counts = {};
    try {
      const value = await fn(counts);
      await rt.db.update(syncRuns).set({ status: "ok", finishedAt: new Date(), counts }).where(eq(syncRuns.id, run!.id));
      return value;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rt.log.error({ kind, err: message }, "sync failed");
      await rt.db.update(syncRuns).set({ status: "failed", finishedAt: new Date(), counts, error: message.slice(0, 2000) }).where(eq(syncRuns.id, run!.id));
      await alertOnRepeatedFailure(rt, kind, message).catch(() => undefined);
      return undefined;
    }
  });
  return locked.ran ? locked.value : undefined;
}

/**
 * Best-effort: tell the web app its cached catalogue pages are stale. A failure here only means pages refresh a little later.
 * `immediate` (an owner's edit in the admin): the very next page view is fresh. Otherwise (background sync) the next view may still be
 * served the previous page while it rebuilds (stale-while-revalidate), which keeps frequent syncs cheap.
 */
export async function revalidateWeb(rt: Pick<Runtime, "env" | "log">, tags: string[] = ["catalog"], opts: { immediate?: boolean } = {}): Promise<void> {
  if (!rt.env.WEB_REVALIDATE_URL) return;
  try {
    await fetch(rt.env.WEB_REVALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-revalidate-secret": rt.env.REVALIDATE_SECRET },
      body: JSON.stringify({ tags, immediate: opts.immediate === true }),
      // An admin click waits for this: keep it short so a slow web container never makes the admin feel stuck.
      signal: AbortSignal.timeout(opts.immediate ? 2000 : 5000),
    });
  } catch (err) {
    rt.log.debug({ err: (err as Error).message }, "web revalidation failed (pages refresh on their own timer)");
  }
}

/** Three failed runs in a row of the same kind: tell the staff chat once (the dashboard shows every failure regardless). */
async function alertOnRepeatedFailure(rt: Runtime, kind: string, message: string): Promise<void> {
  const last = await rt.db.select({ status: syncRuns.status }).from(syncRuns).where(eq(syncRuns.kind, kind)).orderBy(desc(syncRuns.startedAt)).limit(4);
  const consecutive = last.findIndex((r) => r.status !== "failed");
  const failures = consecutive === -1 ? last.length : consecutive;
  if (failures !== 3) return;
  const settings = await loadSettings(rt);
  for (const chatId of settings.staffChatIds) await queueNotification(rt, { kind: "sync_alert", chatId, text: texts.syncAlert(`${kind}: ${message}`.slice(0, 300)) });
}
