import { z } from "zod";

/**
 * What the owner types when adding or editing a product by hand (no MoySklad, or alongside it).
 * Shared by the API (authoritative validation) and the admin form (instant feedback), so both always agree.
 */
export const ManualProductInput = z
  .object({
    name: z.string().trim().min(2, "name_short").max(200),
    article: z.string().trim().max(64).default(""),
    barcodes: z.array(z.string().trim().min(4).max(32).regex(/^[0-9A-Za-z-]+$/, "barcode_chars")).max(10).default([]),
    description: z.string().trim().max(5000).default(""),
    categoryId: z.uuid().nullable().default(null),
    /** Free text: an existing brand is reused (case-insensitive), a new one is created. Empty = no brand. */
    brand: z.string().trim().max(80).default(""),
    /** Unit shown next to the quantity ("dona", "kg", "l", "pachka"...). */
    uom: z.string().trim().max(16).default("dona"),
    /** Quantity step. null = from the unit (Settings → steps by unit), 1 otherwise. */
    qtyStep: z.number().positive().max(1000).nullable().default(null),
    packSize: z.number().int().min(1).max(100_000).nullable().default(null),
    /** Integer UZS. 0 = not for sale yet (kept off the storefront). */
    price: z.number().int().min(0).max(100_000_000_000),
    /** Integer UZS crossed-out price; must be higher than the price to mean anything. */
    oldPrice: z.number().int().min(0).max(100_000_000_000).nullable().default(null),
    /** Units on hand. Orders for a manual product take from it; cancelling an order gives it back. */
    availableQty: z.number().min(0).max(10_000_000),
    hidden: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.oldPrice !== null && v.oldPrice > 0 && v.oldPrice <= v.price) ctx.addIssue({ code: "custom", path: ["oldPrice"], message: "old_price_not_higher" });
  });
export type ManualProductInput = z.infer<typeof ManualProductInput>;

/** The quick edits allowed straight from the product list. For a MoySklad product only `hidden` is accepted. */
export const ProductQuickEdit = z
  .object({
    price: z.number().int().min(0).max(100_000_000_000).optional(),
    availableQty: z.number().min(0).max(10_000_000).optional(),
    hidden: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "empty");
export type ProductQuickEdit = z.infer<typeof ProductQuickEdit>;

/** A manual category needs a name in at least one language (checked by the API); a MoySklad one may leave both empty (= MoySklad's name). */
export const ManualCategoryInput = z.object({
  nameUz: z.string().trim().max(120).default(""),
  nameRu: z.string().trim().max(120).default(""),
  parentId: z.uuid().nullable().default(null),
  sortOrder: z.number().int().min(-10_000).max(10_000).default(0),
});
export type ManualCategoryInput = z.infer<typeof ManualCategoryInput>;

export interface AdminProductImage {
  id: string;
  position: number;
  small: string;
  medium: string;
  large: string;
  /** Size of the original photo; under ~500 px the admin warns it will look soft. */
  width: number | null;
  height: number | null;
  status: string;
}

export interface AdminProductDetail {
  id: string;
  source: "manual" | "moysklad";
  slug: string;
  name: string;
  article: string;
  barcodes: string[];
  description: string;
  categoryId: string | null;
  brand: string;
  uom: string;
  qtyStep: number;
  packSize: number | null;
  price: number;
  oldPrice: number | null;
  availableQty: number;
  hidden: boolean;
  archived: boolean;
  images: AdminProductImage[];
  maxImages: number;
}
