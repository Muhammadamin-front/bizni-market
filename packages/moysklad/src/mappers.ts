import { idFromHref, type RawAttribute, type RawFolder, type RawProduct, type RawStockRow } from "./schemas";
import { parseMsTime } from "./time";
import type { MappingConfig, MsFolder, MsImageRef, MsProduct, MsStockRow } from "./types";

/** MoySklad money is in the minor unit (hundredths). Stored and shown as integer UZS. */
export const toUzs = (minor: number): number => Math.round(minor / 100);
export const toMinor = (uzs: number): number => Math.round(uzs * 100);

export function mapFolder(raw: RawFolder, offsetHours: number): MsFolder {
  const parentHref = raw.productFolder?.meta.href;
  return {
    msId: raw.id,
    name: raw.name,
    pathName: raw.pathName ?? "",
    parentMsId: parentHref ? idFromHref(parentHref) : null,
    archived: raw.archived ?? false,
    updated: raw.updated ? parseMsTime(raw.updated, offsetHours) : null,
  };
}

function attributeText(attr: RawAttribute): string | null {
  const v = attr.value;
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "name" in v && typeof (v as { name: unknown }).name === "string") return ((v as { name: string }).name.trim()) || null;
  return null;
}

function mapPrice(raw: RawProduct, priceTypeId: string): number | null {
  const prices = raw.salePrices ?? [];
  const wanted = priceTypeId
    ? prices.find((p) => (p.priceType?.id ?? (p.priceType?.meta?.href ? idFromHref(p.priceType.meta.href) : "")) === priceTypeId)
    : prices[0];
  if (!wanted || !Number.isFinite(wanted.value)) return null;
  return toUzs(wanted.value);
}

export function mapImages(rows: NonNullable<RawProduct["images"]>["rows"], offsetHours: number): MsImageRef[] {
  return (rows ?? []).map((img) => ({
    msImageId: idFromHref(img.meta.href),
    filename: img.filename ?? "",
    size: img.size ?? 0,
    updated: img.updated ? parseMsTime(img.updated, offsetHours) : null,
    downloadHref: img.meta.downloadHref ?? "",
  }));
}

export function mapProduct(raw: RawProduct, cfg: MappingConfig): MsProduct {
  const folder = raw.productFolder;
  const folderHref = folder?.meta?.href;
  const brandAttr = cfg.brandAttributeId ? raw.attributes?.find((a) => a.id === cfg.brandAttributeId) : undefined;
  const brandName = (brandAttr ? attributeText(brandAttr) : null) ?? raw.supplier?.name?.trim() ?? null;
  const firstPack = raw.packs?.find((p) => (p.quantity ?? 0) > 1);
  const price = mapPrice(raw, cfg.priceTypeId);
  const oldPrice = cfg.oldPriceTypeId ? mapPrice(raw, cfg.oldPriceTypeId) : null;

  return {
    msId: raw.id,
    name: raw.name.trim(),
    article: (raw.article ?? "").trim(),
    code: (raw.code ?? "").trim(),
    externalCode: (raw.externalCode ?? "").trim(),
    // Plain text by contract; rendering code must never treat it as HTML.
    description: (raw.description ?? "").trim(),
    barcodes: (raw.barcodes ?? []).flatMap((b) => Object.values(b).filter((v): v is string => typeof v === "string" && v.length > 0)),
    folderMsId: folder?.id ?? (folderHref ? idFromHref(folderHref) : null),
    folderPathName: raw.pathName ?? folder?.pathName ?? "",
    uom: raw.uom?.name?.trim() || null,
    packSize: firstPack?.quantity ? Math.round(firstPack.quantity) : null,
    price,
    // A "old price" only counts when it is really higher than the selling price.
    oldPrice: oldPrice !== null && price !== null && oldPrice > price ? oldPrice : null,
    archived: raw.archived ?? false,
    updated: parseMsTime(raw.updated, cfg.timezoneOffsetHours),
    brandName: brandName && brandName.length <= 80 ? brandName : null,
    images: mapImages(raw.images?.rows, cfg.timezoneOffsetHours),
    imagesExpanded: raw.images?.rows !== undefined,
  };
}

/** A missing row means zero stock; the caller treats absent products as 0. */
export function mapStockRows(rows: RawStockRow[], stockType: string): MsStockRow[] {
  return rows.map((r) => {
    const preferred = r[stockType];
    const fallback = r["stock"] ?? r["quantity"] ?? r["freeStock"];
    const value = typeof preferred === "number" ? preferred : typeof fallback === "number" ? fallback : 0;
    return { msId: r.assortmentId, quantity: value };
  });
}
