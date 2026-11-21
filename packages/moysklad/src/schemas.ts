import { z } from "zod";

/*
 * Response schemas. They are deliberately tolerant: unknown fields are ignored, almost every field is optional,
 * because MoySklad omits empty fields. What we REQUIRE (id, name, updated, ...) fails loudly into sync_runs.
 */
const meta = z.object({ href: z.string(), type: z.string().optional(), downloadHref: z.string().optional(), size: z.number().optional() }).loose();
const metaRef = z.object({ meta });

export const idFromHref = (href: string): string => href.split("?")[0]!.split("/").filter(Boolean).pop() ?? "";

export const ListMeta = z.object({ size: z.number().default(0), limit: z.number().optional(), offset: z.number().optional() }).loose();

export function listOf<T extends z.ZodType>(row: T) {
  return z.object({ meta: ListMeta.optional(), rows: z.array(row).default([]) }).loose();
}

export const RawFolder = z
  .object({
    id: z.string(),
    name: z.string(),
    pathName: z.string().optional(),
    archived: z.boolean().optional(),
    updated: z.string().optional(),
    productFolder: metaRef.optional(),
  })
  .loose();
export type RawFolder = z.infer<typeof RawFolder>;

export const RawImage = z
  .object({
    meta,
    filename: z.string().optional(),
    size: z.number().optional(),
    updated: z.string().optional(),
    title: z.string().optional(),
  })
  .loose();
export type RawImage = z.infer<typeof RawImage>;

export const RawSalePrice = z
  .object({
    value: z.number(),
    priceType: z.object({ meta: meta.optional(), id: z.string().optional(), name: z.string().optional() }).loose().optional(),
  })
  .loose();

export const RawAttribute = z
  .object({
    id: z.string().optional(),
    meta: meta.optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    value: z.unknown().optional(),
  })
  .loose();
export type RawAttribute = z.infer<typeof RawAttribute>;

export const RawProduct = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string().optional(),
    externalCode: z.string().optional(),
    article: z.string().optional(),
    description: z.string().optional(),
    archived: z.boolean().optional(),
    updated: z.string(),
    pathName: z.string().optional(),
    productFolder: z.object({ meta: meta.optional(), id: z.string().optional(), name: z.string().optional(), pathName: z.string().optional() }).loose().optional(),
    uom: z.object({ meta: meta.optional(), name: z.string().optional() }).loose().optional(),
    images: z.object({ meta: meta.optional(), rows: z.array(RawImage).optional() }).loose().optional(),
    salePrices: z.array(RawSalePrice).optional(),
    barcodes: z.array(z.record(z.string(), z.unknown())).optional(),
    packs: z.array(z.object({ id: z.string().optional(), quantity: z.number().optional(), uom: z.object({ name: z.string().optional() }).loose().optional() }).loose()).optional(),
    supplier: z.object({ name: z.string().optional() }).loose().optional(),
    attributes: z.array(RawAttribute).optional(),
    variantsCount: z.number().optional(),
  })
  .loose();
export type RawProduct = z.infer<typeof RawProduct>;

export const RawStockRow = z.object({ assortmentId: z.string() }).loose();
export type RawStockRow = z.infer<typeof RawStockRow>;
export const StockReport = z.union([z.array(RawStockRow), z.object({ rows: z.array(RawStockRow) }).loose()]);

export const RawNamed = z.object({ id: z.string(), name: z.string().optional(), archived: z.boolean().optional(), meta: meta.optional() }).loose();
export type RawNamed = z.infer<typeof RawNamed>;

export const RawPriceType = z.object({ id: z.string(), name: z.string() }).loose();
export type RawPriceType = z.infer<typeof RawPriceType>;

export const RawState = z.object({ id: z.string(), name: z.string(), stateType: z.string().optional(), meta: meta.optional() }).loose();
export type RawState = z.infer<typeof RawState>;

export const RawCounterparty = z
  .object({ id: z.string(), name: z.string().optional(), phone: z.string().optional(), syncId: z.string().optional(), meta: meta.optional(), tags: z.array(z.string()).optional() })
  .loose();
export type RawCounterparty = z.infer<typeof RawCounterparty>;

export const RawCustomerOrder = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    externalCode: z.string().optional(),
    syncId: z.string().optional(),
    updated: z.string().optional(),
    meta: meta.optional(),
    state: z.object({ meta: meta.optional(), id: z.string().optional(), name: z.string().optional(), stateType: z.string().optional() }).loose().optional(),
  })
  .loose();
export type RawCustomerOrder = z.infer<typeof RawCustomerOrder>;

export const RawWebhook = z.object({ id: z.string(), url: z.string(), action: z.string(), entityType: z.string(), enabled: z.boolean().optional() }).loose();
export type RawWebhook = z.infer<typeof RawWebhook>;

export const RawWebhookStock = z
  .object({ id: z.string(), url: z.string(), stockType: z.string().optional(), reportType: z.string().optional(), enabled: z.boolean().optional() })
  .loose();
export type RawWebhookStock = z.infer<typeof RawWebhookStock>;

export const WebhookPayload = z
  .object({
    auditContext: z.unknown().optional(),
    events: z.array(
      z
        .object({
          meta: z.object({ href: z.string(), type: z.string().optional() }).loose(),
          action: z.string(),
          accountId: z.string().optional(),
        })
        .loose(),
    ),
  })
  .loose();
export type WebhookPayload = z.infer<typeof WebhookPayload>;

export const StockWebhookPayload = z.object({ accountId: z.string().optional(), stockType: z.string().optional(), reportType: z.string().optional(), reportUrl: z.string().optional() }).loose();
export type StockWebhookPayload = z.infer<typeof StockWebhookPayload>;

export const AttributeMeta = z.object({ id: z.string(), name: z.string(), type: z.string().optional() }).loose();
export type AttributeMeta = z.infer<typeof AttributeMeta>;
