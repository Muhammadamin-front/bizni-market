import type { StockStatus } from "./stock";

/**
 * What the storefront shows for one product. Built by the API from the MoySklad read model;
 * it deliberately has no cost/min-price fields, so those can never reach the browser.
 */
export interface ProductCardData {
  id: string;
  slug: string;
  name: string;
  article: string;
  brand: string | null;
  /** Integer UZS. */
  price: number;
  /** Integer UZS, only when a real higher "old price" exists. */
  oldPrice: number | null;
  /** Units per pack when MoySklad defines one; display-only. */
  packSize: number | null;
  /** Unit of measure as entered in MoySklad ("dona", "kg"), or null. */
  unit: string | null;
  /** Quantity increment: 1 for pieces, 0.1/0.5 for goods sold by weight or volume. */
  qtyStep: number;
  stockStatus: StockStatus;
  /** Free units, for the "only N left" line. */
  freeStock: number;
  imageUrl: string | null;
}
