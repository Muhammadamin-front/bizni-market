// Fills an EMPTY shop with sample products through the admin API, so the client can see a full storefront.
// Every product is an ordinary manual product (the owner edits or deletes it in /admin) and says "Namuna tovar" in its description.
// The data and the flat illustrations come from the synthetic MoySklad generator (apps/mock-moysklad), which is invented, not real shop data.
//
//   BASE=http://localhost:3400 ORIGIN=https://biznimarket.vocora.uz ADMIN_EMAIL=… ADMIN_PASSWORD=… \
//     pnpm --filter @shop/core exec tsx scripts/seed-sample-catalog.ts
import sharp from "sharp";
import { artSvg } from "../../../apps/mock-moysklad/src/art";
import { generateDataset } from "../../../apps/mock-moysklad/src/data";

const BASE = process.env.BASE!.replace(/\/$/, "");
const ORIGIN = process.env.ORIGIN ?? BASE;
const RU: Record<string, string> = {
  Kanselyariya: "Канцелярия", "Oziq-ovqat": "Продукты",
  "Ruchkalar va flomasterlar": "Ручки и фломастеры", "Daftar va bloknotlar": "Тетради и блокноты", "Qogʻoz va karton": "Бумага и картон",
  "Papka va fayllar": "Папки и файлы", "Maktab buyumlari": "Школьные товары", "Ofis jihozlari": "Офисные принадлежности",
  Ichimliklar: "Напитки", "Shirinliklar va pechenye": "Сладости и печенье", "Un va yormalar": "Мука и крупы", Konservalar: "Консервы",
  "Sut mahsulotlari": "Молочные продукты", "Choy va kofe": "Чай и кофе",
};

let cookie = "";
async function api<T>(method: string, path: string, body?: unknown, raw?: Buffer): Promise<T> {
  const res = await fetch(`${BASE}/api/v1/admin${path}`, {
    method,
    headers: { "x-requested-with": "shop-admin", origin: ORIGIN, cookie, ...(raw ? { "content-type": "image/png" } : body !== undefined ? { "content-type": "application/json" } : {}) },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0]!;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

await api("POST", "/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
const existing = await api<{ total: number }>("GET", "/products?page=1&filter=all");
if (existing.total > 0) throw new Error(`the shop already has ${existing.total} products - this script only fills an empty shop`);

const { folders, products } = generateDataset(new Date());
const catId = new Map<string, string>();
const roots = folders.filter((f) => !f.parentId);
for (const [i, f] of [...roots, ...folders.filter((f) => f.parentId)].entries()) {
  const parentId = f.parentId ? catId.get(f.parentId)! : null;
  const { id } = await api<{ id: string }>("POST", "/categories", { nameUz: f.name, nameRu: RU[f.name] ?? "", parentId, sortOrder: i });
  catId.set(f.id, id);
}
console.log(`categories: ${catId.size}`);

let n = 0;
for (const p of products.filter((x) => !x.archived)) {
  const stock = Object.values(p.stock).reduce((a, b) => a + b, 0);
  const created = await api<{ id: string }>("POST", "/products", {
    name: p.name,
    article: p.article,
    barcodes: p.barcodes,
    description: `${p.description.replace(/\s*\(demo ma'lumot\)/, "")} Namuna tovar: nomi, narxi va qoldigʻi sinov uchun.`,
    categoryId: catId.get(p.folderId) ?? null,
    brand: p.brand,
    uom: p.uom,
    qtyStep: null,
    packSize: p.packQty,
    price: Math.round(p.priceMinor / 100),
    oldPrice: p.oldPriceMinor ? Math.round(p.oldPriceMinor / 100) : null,
    availableQty: stock,
    hidden: false,
  });
  const png = await sharp(Buffer.from(artSvg(p.art, p.hue))).png().toBuffer();
  await api("POST", `/products/${created.id}/images`, undefined, png);
  if (++n % 25 === 0) console.log(`products: ${n}`);
}
console.log(`done: ${catId.size} categories, ${n} products with photos`);
