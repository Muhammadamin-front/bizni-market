import { enqueueSync } from "../queues";
import type { Runtime } from "../runtime";
import { autoConfigure } from "../settings";
import { revalidateWeb, withRun, type Trigger } from "./common";
import { reconcileProducts, syncFolders, syncProducts } from "./catalog";
import { syncStock } from "./stock";
import { ensureWebhooks } from "./webhooks";

/** First boot / manual "full sync": reference data, every product, full stock, then images in the background. */
export async function fullSync(rt: Runtime, trigger: Trigger): Promise<void> {
  await withRun(rt, "full", trigger, async (counts) => {
    const report = await autoConfigure(rt);
    counts.warnings = report?.warnings.length ?? 0;
    await syncFolders(rt, trigger);
    const seen = await syncProducts(rt, trigger, "full");
    counts.products = seen ?? 0;
    await syncStock(rt, trigger, "full");
    await enqueueSync(rt.queues, "images", trigger);
    await ensureWebhooks(rt, trigger);
    await reconcileProducts(rt, trigger);
    await revalidateWeb(rt);
  }, { lockTtlMs: 60 * 60_000 });
}
