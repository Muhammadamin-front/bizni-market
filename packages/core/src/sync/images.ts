import { and, asc, eq, lt, productImages, or, sql } from "@shop/db";
import { processImage } from "../media";
import { enqueueSync } from "../queues";
import type { Runtime } from "../runtime";
import { revalidateWeb, withRun, type Trigger } from "./common";

const MAX_ATTEMPTS = 5;
/** One run stays within this budget, then re-queues itself, so a 10 000-image first sync never holds a worker forever. */
const RUN_BUDGET_MS = 4 * 60_000;

/** Main images first (position 0), so the catalogue looks complete early and the extras fill in behind it. */
export async function syncImages(rt: Runtime, trigger: Trigger): Promise<void> {
  await withRun(rt, "images", trigger, async (counts) => {
    const started = Date.now();
    for (;;) {
      if (Date.now() - started > RUN_BUDGET_MS) {
        await enqueueSync(rt.queues, "images", "schedule", 5_000);
        counts.requeued = 1;
        break;
      }
      const batch = await rt.db
        .select()
        .from(productImages)
        // Photos uploaded in the admin have no download link and are never (re)downloaded.
        .where(and(sql`${productImages.downloadHref} <> ''`, or(eq(productImages.status, "pending"), and(eq(productImages.status, "failed"), lt(productImages.attempts, MAX_ATTEMPTS)))))
        .orderBy(asc(productImages.position), asc(productImages.attempts))
        .limit(25);
      if (batch.length === 0) break;

      for (const row of batch) {
        try {
          if (!row.downloadHref) throw new Error("no download link");
          const bytes = await rt.ms!.downloadImage(row.downloadHref);
          const done = await processImage(rt.env.MEDIA_DIR, bytes, { square: true });
          await rt.db
            .update(productImages)
            .set({ status: "ready", storageKey: done.storageKey, width: done.width, height: done.height, attempts: 0, lastError: null })
            .where(eq(productImages.id, row.id));
          counts.ready = (counts.ready ?? 0) + 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // A tripped breaker is not this image's fault: stop and let the next run resume.
          if (/circuit breaker/i.test(message)) throw err;
          await rt.db
            .update(productImages)
            .set({ status: "failed", attempts: sql`${productImages.attempts} + 1`, lastError: message.slice(0, 500) })
            .where(eq(productImages.id, row.id));
          counts.failed = (counts.failed ?? 0) + 1;
        }
      }
    }
    if ((counts.ready ?? 0) > 0) await revalidateWeb(rt);
  }, { lockTtlMs: 10 * 60_000 });
}
