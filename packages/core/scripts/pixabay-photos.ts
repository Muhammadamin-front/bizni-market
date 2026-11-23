// Gives the SAMPLE catalogue real photos from Pixabay (free licence, stored on our server, not hot-linked) and adds home banners.
// Only touches products whose description says "Namuna tovar" (the sample seed) — the owner's own products are never changed.
//
//   BASE=http://localhost:3400 ORIGIN=https://kanso.uz ADMIN_EMAIL=… ADMIN_PASSWORD=… PIXABAY_API_KEY=… \
//     tsx scripts/pixabay-photos.ts
import sharp from "sharp";
const BASE = process.env.BASE!.replace(/\/$/, "");
const ORIGIN = process.env.ORIGIN ?? BASE;
const KEY = process.env.PIXABAY_API_KEY!;
if (!KEY) throw new Error("PIXABAY_API_KEY missing");

// Product type (start of the sample name) -> what to search for.
const QUERIES: [string, string][] = [
  ["Ruchka sharikovaya", "ballpoint pen"],
  ["Flomaster", "felt tip markers"],
  ["Daftar katak", "school notebook"],
  ["Bloknot", "spiral notepad"],
  ["Oq qogʻoz", "printer paper stack"],
  ["Rangli karton", "colored paper sheets"],
  ["Papka-skoroshivatel", "office folders"],
  ["Penal", "pencil case"],
  ["Plastilin", "plasticine"],
  ["Shtrix korrektor", "office supplies desk"],
  ["Stepler", "stapler"],
  ["Ichimlik gazsiz", "water bottle"],
  ["Sharbat olma", "apple juice"],
  ["Pechenye", "cookies"],
  ["Shokolad", "chocolate bar"],
  ["Guruch", "rice grains"],
  ["Un oliy nav", "flour"],
  ["Makaron", "pasta"],
  ["Konserva", "canned food"],
  ["Sut", "milk bottle"],
  ["Qatiq", "yogurt"],
  ["Choy qora", "black tea"],
  ["Kofe eruvchan", "coffee"],
];

let cookie = "";
async function api<T>(method: string, path: string, body?: unknown, raw?: { bytes: Buffer; type: string }): Promise<T> {
  const res = await fetch(`${BASE}/api/v1/admin${path}`, {
    method,
    headers: { "x-requested-with": "shop-admin", origin: ORIGIN, cookie, ...(raw ? { "content-type": raw.type } : body !== undefined ? { "content-type": "application/json" } : {}) },
    body: raw ? new Uint8Array(raw.bytes) : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0]!;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

interface Hit { id: number; largeImageURL: string; webformatURL: string; imageWidth: number; imageHeight: number }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function search(q: string, orientation: "horizontal" | "all", n = 20): Promise<Hit[]> {
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(KEY)}&q=${encodeURIComponent(q)}&image_type=photo&orientation=${orientation}&safesearch=true&per_page=${n}&order=popular`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pixabay search "${q}" -> ${res.status}`);
  await sleep(700); // stay well under 100 requests/minute
  return ((await res.json()) as { hits: Hit[] }).hits;
}
async function download(url: string): Promise<{ bytes: Buffer; type: string }> {
  // The CDN rate-limits bursts: pace every download and back off on 429.
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(1500);
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(15000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`download ${res.status}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "image/jpeg" };
  }
  throw new Error("download kept being rate-limited");
}

// Resumable: products already given a photo are listed here (pass STATE=<file>).
import { existsSync, readFileSync, appendFileSync } from "node:fs";
const STATE = process.env.STATE ?? "";
const doneIds = new Set(STATE && existsSync(STATE) ? readFileSync(STATE, "utf8").split("\n").filter(Boolean) : []);

await api("POST", "/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });

// ---------------------------------------------------------------------------- product photos
interface Row { id: string; name: string; source: string }
const all: Row[] = [];
for (let page = 1; ; page++) {
  const r = await api<{ rows: Row[]; total: number; pageSize: number }>("GET", `/products?page=${page}&filter=manual`);
  all.push(...r.rows);
  if (page * r.pageSize >= r.total) break;
}
let done = 0;
const used = new Set<number>();
for (const [prefix, query] of QUERIES) {
  const group = all.filter((p) => p.name.startsWith(prefix));
  if (!group.length) continue;
  const hits = (await search(query, "all")).filter((h) => !used.has(h.id));
  if (!hits.length) {
    console.log(`no photos for "${query}"`);
    continue;
  }
  for (const [i, p] of group.entries()) {
    const detail = await api<{ description: string; images: { id: string }[] }>("GET", `/products/${p.id}`);
    if (!detail.description.includes("Namuna tovar")) continue; // never touch the owner's own products
    if (doneIds.has(p.id)) continue;
    const hit = hits[i % hits.length]!;
    used.add(hit.id);
    // Photos (not packshots): crop to a centred square first, or the shop's square frame letterboxes them with white bands.
    const raw = await download(hit.largeImageURL);
    const img = { bytes: await sharp(raw.bytes).rotate().resize(1000, 1000, { fit: "cover", position: "attention" }).jpeg({ quality: 86 }).toBuffer(), type: "image/jpeg" };
    await api("POST", `/products/${p.id}/images`, undefined, img);
    for (const old of detail.images) await api("DELETE", `/products/${p.id}/images/${old.id}`);
    if (STATE) appendFileSync(STATE, `${p.id}\n`);
    done++;
  }
  console.log(`${prefix}: ${group.length} products`);
}
console.log(`product photos replaced: ${done}`);

// ---------------------------------------------------------------------------- home banners (uz + ru)
const cats = (await (await fetch(`${BASE}/api/v1/categories?locale=uz`)).json()) as { slug: string; name: string; children: { slug: string; name: string }[] }[];
const slugOf = (name: string) => [...cats, ...cats.flatMap((c) => c.children)].find((c) => c.name === name)?.slug;
const BANNERS = [
  { q: "school supplies", cat: "Kanselyariya", uz: ["Maktab va ofis uchun hammasi", "Daftar, ruchka, penal, qogʻoz: narx va qoldiq joriy."], ru: ["Всё для школы и офиса", "Тетради, ручки, пеналы, бумага: цены и наличие актуальны."] },
  { q: "grocery fresh food", cat: "Oziq-ovqat", uz: ["Har kungi oziq-ovqat", "Guruch, un, sut, konserva: bitta savatda kanselyariya bilan birga."], ru: ["Продукты на каждый день", "Рис, мука, молоко, консервы: в одной корзине с канцелярией."] },
  { q: "tea cup coffee", cat: "Choy va kofe", uz: ["Choy va kofe", "Qora choy va eruvchan kofe, bir necha brend."], ru: ["Чай и кофе", "Чёрный чай и растворимый кофе, несколько брендов."] },
  { q: "colorful pencils", cat: "Ruchkalar va flomasterlar", uz: ["Ruchka va flomasterlar", "Dona va toʻplam holida."], ru: ["Ручки и фломастеры", "Поштучно и наборами."] },
];
const existing = await api<{ id: string }[]>("GET", "/banners");
if (existing.length) {
  console.log(`banners already exist (${existing.length}) - not adding more`);
} else {
  for (const [i, b] of BANNERS.entries()) {
    const [hit] = (await search(b.q, "horizontal", 5)).filter((h) => h.imageWidth >= 1600);
    if (!hit) continue;
    const img = await download(hit.largeImageURL);
    const slug = slugOf(b.cat);
    const linkUrl = slug ? `/c/${slug}` : "/catalog";
    for (const locale of ["uz", "ru"] as const) {
      const [title, subtitle] = b[locale];
      const created = await api<{ id: string }>("POST", "/banners", { title, subtitle, linkUrl, locale, position: i });
      await api("POST", `/banners/${created.id}/image`, undefined, img);
    }
  }
  console.log(`banners added: ${BANNERS.length} x 2 languages`);
}
