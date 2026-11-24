import { z } from "zod";
import { normalizePhone } from "./phone";

export const ORDER_CHANNELS = ["web", "tma"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];
export const DELIVERY_METHODS = ["delivery", "pickup"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
/**
 * Our delivery pipeline status. For orders sent to MoySklad the customer-facing status is the MoySklad state (msState).
 * 'local' = the order is handled in our own admin (no MoySklad connected, or it contains manually added products).
 */
export const SYNC_STATUSES = ["pending_sync", "synced", "failed", "cancelled", "local"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** Statuses for orders handled in our admin. Names are fixed in both languages so the customer sees them in their own. */
export const LOCAL_ORDER_STATUSES = ["new", "confirmed", "delivering", "ready", "done", "cancelled"] as const;
export type LocalOrderStatus = (typeof LOCAL_ORDER_STATUSES)[number];
export const LOCAL_ORDER_STATUS_INFO: Record<LocalOrderStatus, { uz: string; ru: string; type: "Regular" | "Successful" | "Unsuccessful" }> = {
  new: { uz: "Yangi", ru: "Новый", type: "Regular" },
  confirmed: { uz: "Tasdiqlandi", ru: "Подтверждён", type: "Regular" },
  delivering: { uz: "Yetkazilmoqda", ru: "Доставляется", type: "Regular" },
  ready: { uz: "Olib ketishga tayyor", ru: "Готов к выдаче", type: "Regular" },
  done: { uz: "Yakunlandi", ru: "Выполнен", type: "Successful" },
  cancelled: { uz: "Bekor qilindi", ru: "Отменён", type: "Unsuccessful" },
};
export function isLocalOrderStatus(v: unknown): v is LocalOrderStatus {
  return typeof v === "string" && (LOCAL_ORDER_STATUSES as readonly string[]).includes(v);
}

/**
 * Cancelled, whichever way the order is handled: our admin status "cancelled", the pipeline status "cancelled", or a MoySklad state
 * of type Unsuccessful. Same rule as the database side (cancelledOrderWhere in core, CANCELLED in core/stats.ts).
 * Only such orders can be deleted for good: their stock already went back when they were cancelled.
 */
export function isCancelledOrder(o: { syncStatus: string; localStatus: string | null; msStateType: string | null }): boolean {
  return (o.syncStatus === "local" && o.localStatus === "cancelled") || o.syncStatus === "cancelled" || (o.syncStatus !== "local" && o.msStateType === "Unsuccessful");
}

export const OrderLineInput = z.object({
  productId: z.uuid(),
  quantity: z.number().positive().max(100_000),
});
export type OrderLine = z.infer<typeof OrderLineInput>;

export const CheckoutInput = z
  .object({
    items: z.array(OrderLineInput).min(1).max(100),
    name: z.string().trim().min(2).max(100),
    phone: z
      .string()
      .trim()
      .refine((v) => normalizePhone(v) !== null, { message: "invalid_phone" })
      .transform((v) => normalizePhone(v) as string),
    deliveryMethod: z.enum(DELIVERY_METHODS).default("delivery"),
    address: z.string().trim().max(255).default(""),
    comment: z.string().trim().max(500).default(""),
    language: z.enum(["uz", "ru"]).default("uz"),
    /** Cloudflare Turnstile response token (guest web checkout). */
    turnstileToken: z.string().max(4096).optional(),
    /** Honeypot: real users never fill this. */
    website: z.string().max(0).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.deliveryMethod === "delivery" && v.address.length < 5) {
      ctx.addIssue({ code: "custom", path: ["address"], message: "address_required" });
    }
  });
export type CheckoutInput = z.infer<typeof CheckoutInput>;

export const CatalogQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().max(120).optional(),
  brand: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : v.split(",").filter(Boolean))),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
  inStock: z
    .union([z.boolean(), z.enum(["1", "true", "0", "false"])])
    .optional()
    .transform((v) => v === true || v === "1" || v === "true"),
  sort: z.enum(["popular", "new", "price_asc", "price_desc", "name"]).default("popular"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
  locale: z.enum(["uz", "ru"]).default("uz"),
});
export type CatalogQuery = z.infer<typeof CatalogQuery>;
