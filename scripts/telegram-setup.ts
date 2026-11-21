/**
 * Run once, after the bot exists and the site has its public https domain:
 *   pnpm telegram:setup
 * Sets the webhook, the menu button (opens the Mini App), commands and descriptions in Uzbek and Russian. Safe to run again.
 */
import { loadEnv, setupTelegram } from "@shop/core";

const env = loadEnv();
const report = await setupTelegram({ token: env.TELEGRAM_BOT_TOKEN, publicUrl: env.PUBLIC_URL, webhookSecret: env.TELEGRAM_WEBHOOK_SECRET });
for (const s of report.steps) console.log(`${s.ok ? "✓" : "✗"} ${s.step}${s.detail ? ` — ${s.detail}` : ""}`);
if (!report.ok) {
  console.error("\nTelegram setup did not complete. Fix the ✗ lines above and run it again.");
  process.exit(1);
}
console.log(`\nDone. Open the bot and send /start. Mini App URL: ${env.PUBLIC_URL.replace(/\/$/, "")}/tma`);
