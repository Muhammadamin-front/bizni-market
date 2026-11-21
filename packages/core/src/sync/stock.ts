import { and, eq, inArray, products, sql, stockLevels } from "@shop/db";
import type { MsStockRow } from "@shop/moysklad";
import type { Runtime } from "../runtime";
import { getState, loadSettings, setState } from "../settings";
import { revalidateWeb, withRun, type Counts, type Trigger } from "./common";

const LAST_OK = "stock_last_ok";
const OVERLAP_MS = 5 * 60_000;
/** MoySklad refuses changedSince older than 24 h; stay well inside it. */
const MAX_LOOKBACK_MS = 23 * 3_600_000;
const chunk = <T>(arr: T[], n: number): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function fetchStock(rt: Runtime, opts: { since?: Date; includeZero: boolean }): Promise<Map<string, Map<string, number>>> {
  const s = await loadSettings(rt);
  // storeId '' = the account-wide figure; otherwise one report per configured store, summed later.
  const stores = s.storeIds.length ? s.storeIds : [""];
  const out = new Map<string, Map<string, number>>();
  for (const storeId of stores) {
    const rows: MsStockRow[] = await rt.ms!.stock({
      stockType: "freeStock",
      storeId: storeId || undefined,
      changedSince: opts.since,
      includeZeroLines: opts.includeZero,
      filterOffsetHours: s.filterTimezoneOffsetHours,
    });
    for (const r of rows) {
      const perStore = out.get(r.msId) ?? new Map<string, number>();
      perStore.set(storeId, r.quantity);
      out.set(r.msId, perStore);
    }
  }
  return out;
}

/** Only MoySklad-owned products: a manual product's available_qty is typed in the admin and has no stock_levels rows to sum. */
async function recomputeAvailable(rt: Runtime, productIds: string[] | "all"): Promise<void> {
  const base = sql`UPDATE products p SET available_qty = COALESCE((SELECT SUM(free_stock) FROM stock_levels s WHERE s.product_id = p.id), 0) WHERE p.source = 'moysklad'`;
  if (productIds === "all") await rt.db.execute(base);
  else for (const part of chunk(productIds, 1000)) await rt.db.execute(sql`${base} AND p.id IN (${sql.join(part.map((id) => sql`${id}::uuid`), sql`, `)})`);
}

/**
 * Stock = freeStock (stock minus reserve) summed over the configured stores. A product MISSING from the report has zero stock,
 * which is why the daily full pass also zeroes everything the report did not mention.
 */
export async function syncStock(rt: Runtime, trigger: Trigger, requested: "changed" | "full" = "changed"): Promise<void> {
  await withRun(rt, "stock", trigger, async (counts) => {
    const startedAt = new Date();
    const lastOk = await getState<string>(rt, LAST_OK);
    const canDelta = requested === "changed" && lastOk && startedAt.getTime() - new Date(lastOk).getTime() < MAX_LOOKBACK_MS;
    const since = canDelta ? new Date(new Date(lastOk!).getTime() - OVERLAP_MS) : undefined;
    counts.mode = canDelta ? 0 : 1; // 0 = changedSince window, 1 = full report

    const report = await fetchStock(rt, { since, includeZero: !canDelta });
    const known = await rt.db
      .select({ id: products.id, msId: products.msId })
      .from(products)
      .where(and(inArray(products.msId, [...report.keys()]), eq(products.source, "moysklad")));
    const idByMs = new Map(known.map((k) => [k.msId, k.id]));

    const rows: { productId: string; storeId: string; freeStock: number; stock: number; updatedAt: Date }[] = [];
    for (const [msId, perStore] of report) {
      const productId = idByMs.get(msId);
      if (!productId) {
        counts.unknown = (counts.unknown ?? 0) + 1; // a variant, a service, or a product the next product sync will bring
        continue;
      }
      for (const [storeId, qty] of perStore) rows.push({ productId, storeId, freeStock: qty, stock: qty, updatedAt: startedAt });
    }
    for (const part of chunk(rows, 500)) {
      await rt.db
        .insert(stockLevels)
        .values(part)
        .onConflictDoUpdate({
          target: [stockLevels.productId, stockLevels.storeId],
          set: { freeStock: sql`excluded.free_stock`, stock: sql`excluded.stock`, updatedAt: sql`excluded.updated_at` },
        });
    }

    if (!canDelta) {
      // Full pass: anything the report did not mention is out of stock.
      await rt.db.update(stockLevels).set({ freeStock: 0, stock: 0, updatedAt: startedAt }).where(sql`${stockLevels.updatedAt} < ${startedAt}`);
      await recomputeAvailable(rt, "all");
    } else {
      await recomputeAvailable(rt, [...new Set(rows.map((r) => r.productId))]);
    }

    counts.rows = rows.length;
    await setState(rt, LAST_OK, startedAt.toISOString());
    if (rows.length > 0) await revalidateWeb(rt);
  });
}

export async function stockSummary(rt: Pick<Runtime, "db">): Promise<{ inStock: number; outOfStock: number }> {
  const [row] = await rt.db
    .select({
      inStock: sql<number>`count(*) FILTER (WHERE ${products.availableQty} > 0)::int`,
      outOfStock: sql<number>`count(*) FILTER (WHERE ${products.availableQty} <= 0)::int`,
    })
    .from(products)
    .where(eq(products.archived, false));
  return row ?? { inStock: 0, outOfStock: 0 };
}

export type { Counts };
