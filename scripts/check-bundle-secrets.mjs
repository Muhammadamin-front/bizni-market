// Fails when anything that must stay on the server shows up in the JavaScript/CSS the browser downloads.
//   pnpm --filter @shop/web build && node scripts/check-bundle-secrets.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? "apps/web/.next/static");
const FORBIDDEN = [
  "MOYSKLAD_TOKEN", "MOYSKLAD_WEBHOOK", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "SESSION_SECRET", "REVALIDATE_SECRET", "TURNSTILE_SECRET",
  "DATABASE_URL", "REDIS_URL", "ADMIN_PASSWORD", "api.moysklad.ru", "@shop/moysklad", "drizzle-orm", "bullmq", "buyPrice", "minPrice",
];
let files = 0;
const hits = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|map|html|json)$/.test(name)) {
      files++;
      const body = readFileSync(p, "utf8");
      for (const word of FORBIDDEN) if (body.includes(word)) hits.push(`${path.relative(ROOT, p)}: ${word}`);
    }
  }
})(ROOT);
if (hits.length) {
  console.error(`FOUND server-only strings in browser bundles:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`clean: ${files} browser files scanned, no server-only strings.`);
