/**
 * Phase 1b: a READ-ONLY look at a real MoySklad account. Run it once the token exists:
 *   MOYSKLAD_TOKEN=... pnpm probe
 * It never writes anything (no webhook creation, no orders). It prints what the account really looks like, and settles the facts the
 * docs leave open (input time zone, archived products in lists, expand=images, image links, rate-limit headers).
 */
import { MoySkladClient, type MappingConfig } from "./index";
import { formatMsTime } from "./time";

const token = process.env.MOYSKLAD_TOKEN ?? "";
const baseUrl = process.env.MOYSKLAD_BASE_URL ?? "https://api.moysklad.ru/api/remap/1.2";
if (!token) {
  console.error("MOYSKLAD_TOKEN is empty. Put it in .env (never in chat) and run `pnpm probe` again.");
  process.exit(2);
}

const headers: Record<string, string>[] = [];
const client = new MoySkladClient({ baseUrl, token, requestWeight: Number(process.env.MOYSKLAD_REQUEST_WEIGHT ?? 4), onRateHeaders: (h) => headers.push({ ...(h as Record<string, string>) }) });
const section = (t: string) => console.log(`\n=== ${t}`);
const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch (err) {
    console.log(`  ✗ ${label}: ${(err as Error).message}`);
    return null;
  }
};

section("Account lists");
const priceTypes = await safe("price types", () => client.priceTypes());
console.log("  price types:", priceTypes?.map((p) => `${p.name} (${p.id})`).join("; ") ?? "?");
const stores = await safe("stores", () => client.stores());
console.log("  stores:", stores?.map((s) => `${s.name} (${s.id})`).join("; ") ?? "?");
const orgs = await safe("organizations", () => client.organizations());
console.log("  organizations:", orgs?.map((s) => `${s.name} (${s.id})`).join("; ") ?? "?");
const channels = await safe("sales channels", () => client.salesChannels());
console.log("  sales channels:", channels?.map((s) => s.name).join("; ") || "(none)");
const states = await safe("order states", () => client.orderStates());
console.log("  order states:", states?.map((s) => `${s.name} [${s.stateType}]`).join("; ") ?? "?");
const attrs = await safe("product attributes", () => client.productAttributes());
console.log("  product custom fields:", attrs?.map((a) => `${a.name} (${a.type}) ${a.id}`).join("; ") || "(none)  → brand will come from the supplier");

section("Catalogue shape");
const cfg: MappingConfig = { priceTypeId: priceTypes?.[0]?.id ?? "", oldPriceTypeId: "", brandAttributeId: attrs?.find((a) => /brend|brand|бренд/i.test(a.name))?.id ?? "", timezoneOffsetHours: 3 };
const sample = await safe("first product page", async () => {
  for await (const page of client.products(cfg)) return page;
  return [];
});
if (sample) {
  console.log(`  first page: ${sample.length} products; with price ${sample.filter((p) => p.price).length}; with image ${sample.filter((p) => p.images.length).length}; archived ${sample.filter((p) => p.archived).length}`);
  console.log(`  brands seen: ${[...new Set(sample.map((p) => p.brandName).filter(Boolean))].slice(0, 15).join(", ") || "(none)"}`);
  console.log(`  uom seen: ${[...new Set(sample.map((p) => p.uom).filter(Boolean))].join(", ") || "(none)"}  → kg/l units become weighted (fractional) items`);
  console.log(`  packs: ${sample.filter((p) => p.packSize).length} products define a pack size`);
  console.log("  imagesExpanded:", sample.every((p) => p.imagesExpanded) ? "yes (expand=images works at limit=100)" : "NO: images must be fetched per product");
}
const ids = await safe("all product ids", () => client.allProductIds());
console.log(`  total products (incl. archived): ${ids?.length ?? "?"}`);

section("Open questions the docs could not answer");
const probe = sample?.[0];
if (probe) {
  const since = new Date(probe.updated.getTime() - 1000);
  // If the server reads our input as MSK, filtering with MSK-formatted input returns this product; if it reads UTC, the 3-hour skew hides it.
  for (const offset of [3, 0]) {
    const found = await safe(`filter with offset ${offset}`, async () => {
      for await (const page of client.products(cfg, { since, filterOffsetHours: offset })) return page.some((p) => p.msId === probe.msId);
      return false;
    });
    console.log(`  updated>= input read with UTC+${offset}: product found = ${found}`);
  }
  console.log("  → If UTC+3 says true the server reads input as Moscow time (keep filterTimezoneOffsetHours = 3). If UTC+3 says false and UTC+0 says true, set it to 0.");
}
const stock = await safe("stock report", () => client.stock({ stockType: "freeStock" }));
console.log(`  stock report: ${stock?.length ?? "?"} non-zero rows (a missing row means zero)`);
if (sample?.[0]?.images[0]) {
  const img = sample[0].images[0];
  const bytes = await safe("image download", () => client.downloadImage(img.downloadHref));
  console.log(`  image download: ${bytes ? `${bytes.length} bytes` : "failed"} from ${new URL(img.downloadHref).host}`);
}
const hooks = await safe("webhooks", () => client.webhooks());
console.log(`  webhooks list: ${hooks ? `${hooks.length} existing (this tariff can read them; creating needs admin rights)` : "not available → polling only"}`);

section("Rate limit headers seen");
const last = headers.filter((h) => h.limit !== undefined).slice(-3);
console.log(" ", last.length ? JSON.stringify(last) : "(none returned)");
console.log(`\nProbe time: ${formatMsTime(new Date())} MSK. Nothing was written to MoySklad.`);
