// End-to-end smoke test in a real (headless) Chrome against a RUNNING stack (dev servers or the docker compose stack).
//   BASE_URL=http://localhost:3000 MOCK_URL=http://localhost:4010 ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/smoke.mjs
// Covers: browse -> search -> cart -> checkout -> order in (mock) MoySklad -> status change flows back -> admin -> Mini App (dev mode)
// plus horizontal-overflow and axe accessibility checks at 375 / 768 / 1440 px.
// NOTE: it places real orders. Guest checkout is rate-limited per IP (8 / 10 min) and per phone (5 / h), so a few reruns in a row will see 429s - that is the
// limiter working. Clear it between runs: `docker compose ... exec redis sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`.
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MOCK = (process.env.MOCK_URL ?? "http://localhost:4010").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "owner@shop.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error("Set ADMIN_PASSWORD (the stack's admin password) before running the smoke test.");
  process.exit(2);
}
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.SMOKE_OUT ?? "scripts/out";
mkdirSync(OUT, { recursive: true });

const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const results = [];
const step = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
    console.log(`✗ ${name} — ${err.message}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => document.body.innerText);
const waitText = (page, needle, timeout = 20000) => page.waitForFunction((n) => document.body.innerText.includes(n), { timeout }, needle);
async function clickText(page, label, nth = 0, tag = "button") {
  const ok = await page.evaluate((l, n, t) => {
    const els = [...document.querySelectorAll(t)].filter((e) => e.textContent.trim() === l);
    if (!els[n]) return false;
    els[n].click();
    return true;
  }, label, nth, tag);
  if (!ok) throw new Error(`no ${tag} "${label}" (#${nth})`);
}
const mockState = async () => (await fetch(`${MOCK}/__mock/state`)).json();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const consoleErrors = [];
async function newPage(width = 390, height = 844) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource.*(404|401)/.test(m.text()) && consoleErrors.push(`${page.url()} :: ${m.text()}`));
  page.on("pageerror", (e) => consoleErrors.push(`${page.url()} :: ${e.message}`));
  // Remember the last order POST, so a failed checkout step can say WHY (status + body) instead of only "timed out".
  page.on("response", async (r) => {
    if (r.request().method() === "POST" && r.url().includes("/api/v1/orders")) page.lastOrder = `${r.status()} ${(await r.text().catch(() => "")).slice(0, 200)}`;
  });
  return page;
}

let orderNumber = "";
const page = await newPage();

await step("home renders with categories", async () => {
  const res = await page.goto(`${BASE}/uz`, { waitUntil: "networkidle2" });
  if (res.status() !== 200) throw new Error(`status ${res.status()}`);
  await waitText(page, "Kategoriyalar");
});
await step("root redirects to a locale", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  if (!/\/(uz|ru)\/?$/.test(page.url())) throw new Error(`landed on ${page.url()}`);
  return page.url();
});
await step("Cyrillic search finds Latin-named products", async () => {
  await page.goto(`${BASE}/uz/catalog?q=${encodeURIComponent("ручка")}`, { waitUntil: "networkidle2" });
  const t = await text(page);
  if (!/Ruchka/i.test(t)) throw new Error("no 'Ruchka' in results");
});
await step("add two products, cart shows fresh prices", async () => {
  await clickText(page, "Savatga", 0);
  await clickText(page, "Savatga", 1);
  await page.goto(`${BASE}/uz/cart`, { waitUntil: "networkidle2" });
  await waitText(page, "Jami");
  const t = await text(page);
  if (!/so.m/.test(t)) throw new Error("no prices in cart");
});
await step("checkout creates an order", async () => {
  await page.goto(`${BASE}/uz/checkout`, { waitUntil: "networkidle2" });
  await page.type('input[autocomplete="name"]', "Smoke Test");
  await page.type('input[autocomplete="tel"]', "90 123 45 67");
  await page.type('input[autocomplete="street-address"]', "Chilonzor 12, 5-xonadon");
  await page.click('button[type="submit"]');
  await waitText(page, "Buyurtmangiz qabul qilindi", 30000);
  orderNumber = (await text(page)).match(/№([A-Z]\d+)/)?.[1] ?? "";
  if (!orderNumber) throw new Error("no order number shown");
  return orderNumber;
});
await step("the order reaches MoySklad exactly once", async () => {
  for (let i = 0; i < 30; i++) {
    const s = await mockState();
    const mine = s.orders.filter((o) => o.name === orderNumber);
    if (mine.length === 1) return `state ${mine[0].state}`;
    if (mine.length > 1) throw new Error("duplicate orders in MoySklad");
    await sleep(1000);
  }
  throw new Error("order did not reach MoySklad within 30 s");
});
await step("a status change made in MoySklad reaches the customer", async () => {
  const s = await mockState();
  const o = s.orders.find((x) => x.name === orderNumber);
  await fetch(`${MOCK}/__mock/order/${o.id}/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: "Tasdiqlandi" }) });
  await page.reload({ waitUntil: "networkidle2" });
  // webhook (~10 s) or the 2-minute poll
  for (let i = 0; i < 70; i++) {
    await page.reload({ waitUntil: "networkidle2" });
    if ((await text(page)).includes("Tasdiqlandi")) return `after ${i * 2} s`;
    await sleep(1500);
  }
  throw new Error("status did not update");
});

// ------------------------------------------------------------------ admin
const admin = await newPage(1280, 900);
await step("admin: login and dashboard", async () => {
  await admin.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  // The admin opens in Uzbek; the checks below read the Russian texts.
  await admin.evaluate(() => localStorage.setItem("admin_lang", "ru"));
  await admin.reload({ waitUntil: "networkidle2" });
  await admin.waitForSelector('input[type="email"]');
  await admin.type('input[type="email"]', ADMIN_EMAIL);
  await admin.type('input[type="password"]', ADMIN_PASSWORD);
  await admin.click('button[type="submit"]');
  await waitText(admin, "Товаров на витрине");
});
await step("admin: order visible, status written through to MoySklad", async () => {
  await admin.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle2" });
  await waitText(admin, orderNumber);
  await clickText(admin, orderNumber, 0, "a");
  await waitText(admin, "Сменить статус");
  await clickText(admin, "Yetkazildi", 0);
  await waitText(admin, "Статус: Yetkazildi", 15000);
  const s = await mockState();
  if (s.orders.find((o) => o.name === orderNumber)?.state !== "Yetkazildi") throw new Error("MoySklad did not receive the state");
});
await step("admin: sync and settings pages load", async () => {
  for (const p of ["/admin/sync", "/admin/settings", "/admin/products", "/admin/content", "/admin/system"]) {
    await admin.goto(`${BASE}${p}`, { waitUntil: "networkidle2" });
    await sleep(500);
    if ((await text(admin)).trim().length < 40) throw new Error(`${p} rendered nothing`);
  }
});

// ------------------------------------------------------------------ Mini App (dev stand-in user)
const tma = await newPage(390, 844);
await step("Mini App: opens, signs in, shows the tab bar", async () => {
  await tma.goto(`${BASE}/tma`, { waitUntil: "networkidle2" });
  await tma.waitForSelector('nav[aria-label="Asosiy menyu"]', { timeout: 20000 });
});
await step("Mini App: catalogue, add to cart, order", async () => {
  await tma.goto(`${BASE}/tma/catalog`, { waitUntil: "networkidle2" });
  await tma.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Savatga"), { timeout: 20000 });
  await clickText(tma, "Savatga", 0);
  await tma.goto(`${BASE}/tma/checkout`, { waitUntil: "networkidle2" });
  await tma.waitForSelector('input[autocomplete="name"]', { timeout: 15000 });
  // The phone is remembered from earlier orders and prefilled (by design): select it first, then type over it.
  await tma.focus('input[autocomplete="tel"]');
  await tma.evaluate(() => document.querySelector('input[autocomplete="tel"]').select());
  await tma.type('input[autocomplete="tel"]', "91 555 66 77");
  // The radio is visually hidden (sr-only): click it in the page, not at screen coordinates, where the fixed tab bar sits.
  await tma.evaluate(() => document.querySelector('input[value="pickup"]')?.click());
  const name = await tma.$eval('input[autocomplete="name"]', (e) => e.value);
  if (!name) await tma.type('input[autocomplete="name"]', "TMA Test");
  // Centre the button first: left at the page bottom it sits behind the fixed tab bar and a coordinate click would hit the bar.
  await tma.evaluate(() => document.querySelector('button[type="submit"]').scrollIntoView({ block: "center" }));
  await tma.click('button[type="submit"]');
  await waitText(tma, "Buyurtmangiz qabul qilindi", 30000).catch(async (e) => {
    const shown = await tma.evaluate(() => [...document.querySelectorAll("[role=alert], .text-promo, input")].map((x) => x.tagName === "INPUT" ? `${x.autocomplete}=${x.value}` : x.textContent.trim()).join(" | "));
    throw new Error(`${e.message}; last order POST: ${tma.lastOrder ?? "none"}; page: ${String(tma.url())}; form: ${shown}`);
  });
  const n = (await text(tma)).match(/№([A-Z]\d+)/)?.[1];
  if (!/^T/.test(n ?? "")) throw new Error(`expected a T-number, got ${n}`);
  return n;
});
await step("Mini App: orders and profile pages", async () => {
  await tma.goto(`${BASE}/tma/orders`, { waitUntil: "networkidle2" });
  await waitText(tma, "Buyurtmalarim");
  await tma.goto(`${BASE}/tma/profile`, { waitUntil: "networkidle2" });
  await waitText(tma, "Profil");
});

// ------------------------------------------------------------------ layout + accessibility at three widths
const pagesToCheck = ["/uz", "/uz/catalog", "/uz/cart", "/uz/checkout", "/ru"];
for (const width of [375, 768, 1440]) {
  const p = await newPage(width, 900);
  for (const path of pagesToCheck) {
    await step(`layout ${width}px ${path}: no horizontal scroll`, async () => {
      await p.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
      const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (w.sw > w.iw + 1) throw new Error(`scrollWidth ${w.sw} > ${w.iw}`);
      if (path === "/uz/catalog") await p.screenshot({ path: `${OUT}/catalog-${width}.png` });
    });
  }
  if (width === 375) {
    for (const path of ["/uz", "/uz/catalog", "/uz/cart"]) {
      await step(`a11y (axe) ${path}`, async () => {
        await p.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
        await p.evaluate(axeSource);
        const v = await p.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "best-practice"] })).violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length })));
        const bad = v.filter((x) => x.impact === "critical" || x.impact === "serious");
        if (bad.length) throw new Error(JSON.stringify(bad));
        return v.length ? `minor: ${v.map((x) => `${x.id}×${x.n}`).join(", ")}` : "clean";
      });
    }
  }
  await p.close();
}

await step("no console errors during the run", async () => {
  if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 5).join(" | "));
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed${failed.length ? `, ${failed.length} FAILED` : ""}. Screenshots: ${OUT}/`);
process.exit(failed.length ? 1 : 0);
