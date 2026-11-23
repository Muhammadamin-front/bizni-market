// Adds the shop's category list (the mirl.uz-style catalogue) through the admin API. Safe to run again: a category that already
// exists (same Uzbek or Russian name) is skipped. Products are NOT created here: the owner adds them in /admin.
// They all go INSIDE the "Kanselyariya" section (created if missing), so they never mix with "Kompyuterlar va xizmatlar".
//
//   BASE=https://kanso.uz ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm --filter @shop/core exec tsx scripts/seed-categories.ts
// Add DRY=1 to only print what would be created.
const BASE = process.env.BASE!.replace(/\/$/, "");
const ORIGIN = process.env.ORIGIN ?? BASE;

const CATEGORIES: { uz: string; ru: string }[] = [
  { uz: "Qogʻoz mahsulotlari", ru: "Бумажная продукция" },
  { uz: "Maishiy tovarlar", ru: "Бытовые товары" },
  { uz: "Kitoblar", ru: "Книги" },
  { uz: "Ofis qogʻozi", ru: "Офисная бумага" },
  { uz: "Ofis texnikasi", ru: "Офисная техника" },
  { uz: "Ofis buyumlari", ru: "Офисные товары" },
  { uz: "Papkalar va arxivlash tizimlari", ru: "Папки и системы архивации" },
  { uz: "Yozuv buyumlari", ru: "Письменные принадлежности" },
  { uz: "Sport tovarlari", ru: "Спорт товары" },
  { uz: "Ijodkorlik uchun tovarlar", ru: "Товары для творчества" },
  { uz: "Maktab buyumlari", ru: "Школьные товары" },
  { uz: "Shtempel mahsulotlari", ru: "Штемпельная продукция" },
];

let cookie = "";
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/v1/admin${path}`, {
    method,
    headers: { "x-requested-with": "shop-admin", origin: ORIGIN, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0]!;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

await api("POST", "/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
const existing = await api<{ id: string; name: string; uz: string | null; ru: string | null; sort_order: number; parent_id: string | null }[]>("GET", "/categories");
const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
const have = new Set(existing.flatMap((c) => [norm(c.name), norm(c.uz), norm(c.ru)]).filter(Boolean));
let order = existing.reduce((max, c) => Math.max(max, c.sort_order), 0);

const isStationery = (c: { name: string; uz: string | null; ru: string | null }) => /kanselyar|канцеляр/i.test(`${c.name} ${c.uz ?? ""} ${c.ru ?? ""}`);
let sectionId = existing.find((c) => c.parent_id === null && isStationery(c))?.id ?? null;
if (!sectionId) {
  if (process.env.DRY) console.log("would create section: Kanselyariya");
  else {
    order += 1;
    sectionId = (await api<{ id: string }>("POST", "/categories", { nameUz: "Kanselyariya", nameRu: "Канцелярия", parentId: null, sortOrder: order })).id;
    console.log("created section: Kanselyariya");
  }
}

for (const c of CATEGORIES) {
  if (have.has(norm(c.uz)) || have.has(norm(c.ru))) {
    console.log(`skip (exists): ${c.uz}`);
    continue;
  }
  if (process.env.DRY) {
    console.log(`would create: ${c.uz} / ${c.ru}`);
    continue;
  }
  order += 1;
  await api("POST", "/categories", { nameUz: c.uz, nameRu: c.ru, parentId: sectionId, sortOrder: order });
  console.log(`created: ${c.uz}`);
}
