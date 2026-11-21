import { z } from "zod";

/**
 * Everything that depends on how the owner has set up MoySklad lives here, never in code, so the answers to
 * "which price type / which warehouses / one organisation or two" are settings changes, not releases.
 * All ids are MoySklad ids. A field left empty means "use the automatic default" (when exactly one option exists).
 */
export const IntegrationSettingsSchema = z.object({
  priceTypeId: z.string().default(""),
  oldPriceTypeId: z.string().default(""),
  /** Free stock is summed over these stores. Empty = all stores. */
  storeIds: z.array(z.string()).default([]),
  /** Custom attribute that holds the brand. Empty = fall back to the product's supplier, then no brand. */
  brandAttributeId: z.string().default(""),
  organizationId: z.string().default(""),
  /** Warehouse written on new orders. */
  orderStoreId: z.string().default(""),
  salesChannelId: z.string().default(""),
  initialStateId: z.string().default(""),
  /** When staff move an order to this state, stock is reserved (see reserve policy). */
  confirmedStateId: z.string().default(""),
  reserveOnCreateWeb: z.boolean().default(false),
  reserveOnCreateTma: z.boolean().default(false),
  /** site-only: guests only attach to counterparties the site created. trust-phone: also match staff-created ones. */
  counterpartyMatching: z.enum(["site-only", "trust-phone"]).default("site-only"),
  lowStockThreshold: z.number().int().min(1).default(5),
  /** Hide products without a photo from the storefront. */
  requireImage: z.boolean().default(false),
  /** Keep this many images per product at most. */
  maxImagesPerProduct: z.number().int().min(1).max(10).default(5),
  /** Quantity step by unit of measure (lower-case). Anything not listed sells in whole units. */
  qtyStepByUom: z.record(z.string(), z.number().positive()).default({ kg: 0.1, "кг": 0.1, kilogramm: 0.1, l: 0.5, "л": 0.5, litr: 0.5 }),
  minimumOrderAmount: z.number().int().min(0).default(0),
  /** Telegram chat ids that receive every new order (staff group). */
  staffChatIds: z.array(z.number()).default([]),
  /** Business-order prefix on MoySklad order names. */
  orderPrefixWeb: z.string().default("W"),
  orderPrefixTma: z.string().default("T"),
  /** UTC offset hours MoySklad uses for filter input. The probe confirms this; MSK = 3. */
  filterTimezoneOffsetHours: z.number().default(3),
  /** Category slug -> segment, so the home page can show "Kanselyariya" and "Oziq-ovqat" separately. */
  segmentRootCategories: z.record(z.string(), z.enum(["stationery", "grocery"])).default({}),
});

export type IntegrationSettings = z.infer<typeof IntegrationSettingsSchema>;
export const DEFAULT_SETTINGS: IntegrationSettings = IntegrationSettingsSchema.parse({});
