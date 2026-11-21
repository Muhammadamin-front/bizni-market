import { timingSafeEqual } from "node:crypto";
import { recordWebhook, TelegramApi, texts, type Runtime } from "@shop/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function hookRoutes(app: FastifyInstance, rt: Runtime) {
  // Public URLs carry an /api prefix (the web app proxies /api/* to this service). Accept it here too, so a webhook base URL that points
  // straight at the API (internal demo setups) cannot silently 404.
  for (const prefix of ["", "/api"]) hookRoutesAt(app, rt, prefix);
}

function hookRoutesAt(app: FastifyInstance, rt: Runtime, prefix: string) {
  /**
   * MoySklad webhook. Unsigned, 1.5 s deadline, three retries: so this does the bare minimum (check the secret path, record, answer)
   * and leaves everything else to the worker, which re-fetches the entities itself.
   */
  app.post(`${prefix}/webhooks/ms/:secret`, async (req, reply) => {
    const secret = (req.params as { secret: string }).secret;
    if (!rt.env.MOYSKLAD_WEBHOOK_SECRET || !safeEqual(secret, rt.env.MOYSKLAD_WEBHOOK_SECRET)) return reply.code(404).send();
    const requestId = z.string().max(100).catch("").parse((req.query as { requestId?: string }).requestId) || `anon-${Date.now()}`;
    await recordWebhook(rt, requestId, req.body).catch((err) => rt.log.error({ err: (err as Error).message }, "webhook record failed"));
    return reply.code(200).send();
  });

  const Update = z
    .object({
      message: z
        .object({
          text: z.string().optional(),
          chat: z.object({ id: z.number() }),
          from: z.object({ language_code: z.string().optional() }).optional(),
        })
        .optional(),
    })
    .loose();

  /** Telegram bot updates: only /start does anything — it hands the user the Mini App. */
  app.post(`${prefix}/webhooks/telegram/:secret`, async (req, reply) => {
    const secret = (req.params as { secret: string }).secret;
    const header = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
    const expected = rt.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || !safeEqual(secret, expected) || !safeEqual(header, expected)) return reply.code(404).send();
    const update = Update.safeParse(req.body);
    const message = update.success ? update.data.message : undefined;
    if (message?.text?.startsWith("/start")) {
      const locale = message.from?.language_code?.startsWith("ru") ? "ru" : "uz";
      const bot = new TelegramApi(rt.env.TELEGRAM_BOT_TOKEN);
      void bot
        .sendMessage(message.chat.id, texts.start(locale), {
          reply_markup: { inline_keyboard: [[{ text: texts.openShop(locale), web_app: { url: `${rt.env.PUBLIC_URL.replace(/\/$/, "")}/tma` } }]] },
        })
        .catch(() => undefined);
    }
    return reply.code(200).send();
  });
}
