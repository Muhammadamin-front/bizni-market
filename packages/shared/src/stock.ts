export type StockStatus = "in" | "low" | "out";

/** A product with fewer than this many units free is shown as "low". Configurable per shop later. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/**
 * Derives the customer-facing stock status from MoySklad's free stock (stock minus reserve).
 * A missing figure counts as 0: the stock report omits rows whose stock is zero.
 */
export function stockStatus(
  freeStock: number | null | undefined,
  lowThreshold: number = DEFAULT_LOW_STOCK_THRESHOLD,
): StockStatus {
  const free = freeStock ?? 0;
  if (free <= 0) return "out";
  if (free < lowThreshold) return "low";
  return "in";
}
