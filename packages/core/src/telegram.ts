/**
 * Minimal Telegram Bot API client (plain fetch: five methods do not justify a framework).
 * Every call is a no-op result when no token is configured, so the whole system runs before the bot exists.
 */
export interface TelegramResult<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TelegramApi {
  constructor(private readonly token: string) {}

  get enabled(): boolean {
    return this.token.length > 0;
  }

  async call<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<TelegramResult<T>> {
    if (!this.enabled) return { ok: false, description: "no bot token configured" };
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return (await res.json()) as TelegramResult<T>;
  }

  sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
    return this.call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...extra });
  }
  setWebhook(url: string, secretToken: string) {
    return this.call("setWebhook", { url, secret_token: secretToken, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
  }
  setChatMenuButton(text: string, url: string) {
    return this.call("setChatMenuButton", { menu_button: { type: "web_app", text, web_app: { url } } });
  }
  setMyCommands(commands: { command: string; description: string }[], languageCode?: string) {
    return this.call("setMyCommands", { commands, ...(languageCode ? { language_code: languageCode } : {}) });
  }
  setMyDescription(description: string, languageCode?: string) {
    return this.call("setMyDescription", { description, ...(languageCode ? { language_code: languageCode } : {}) });
  }
  setMyShortDescription(description: string, languageCode?: string) {
    return this.call("setMyShortDescription", { short_description: description, ...(languageCode ? { language_code: languageCode } : {}) });
  }
  getMe() {
    return this.call<{ id: number; username: string; first_name: string }>("getMe");
  }
  getWebhookInfo() {
    return this.call<{ url: string; pending_update_count: number; last_error_message?: string }>("getWebhookInfo");
  }
}

export interface TelegramSetupReport {
  ok: boolean;
  steps: { step: string; ok: boolean; detail?: string }[];
}

/**
 * One-time (idempotent) bot setup, run when the token and the public https domain exist: webhook, menu button, commands, descriptions in uz and ru.
 * Used by `pnpm telegram:setup` and by the admin "Set up bot" button.
 */
export async function setupTelegram(opts: { token: string; publicUrl: string; webhookSecret: string }): Promise<TelegramSetupReport> {
  const bot = new TelegramApi(opts.token);
  const steps: TelegramSetupReport["steps"] = [];
  const record = (step: string, r: TelegramResult) => steps.push({ step, ok: r.ok, detail: r.ok ? undefined : r.description });

  if (!bot.enabled) return { ok: false, steps: [{ step: "token", ok: false, detail: "TELEGRAM_BOT_TOKEN is empty" }] };
  if (!/^https:\/\//.test(opts.publicUrl)) return { ok: false, steps: [{ step: "url", ok: false, detail: `PUBLIC_URL must be https (got ${opts.publicUrl})` }] };
  if (!opts.webhookSecret) return { ok: false, steps: [{ step: "secret", ok: false, detail: "TELEGRAM_WEBHOOK_SECRET is empty" }] };

  const base = opts.publicUrl.replace(/\/$/, "");
  record("getMe", await bot.getMe());
  record("setWebhook", await bot.setWebhook(`${base}/api/webhooks/telegram/${opts.webhookSecret}`, opts.webhookSecret));
  record("setChatMenuButton", await bot.setChatMenuButton("Do‘kon / Магазин", `${base}/tma`));
  record("setMyCommands(uz)", await bot.setMyCommands([{ command: "start", description: "Do‘konni ochish" }], "uz"));
  record("setMyCommands(ru)", await bot.setMyCommands([{ command: "start", description: "Открыть магазин" }], "ru"));
  record("setMyCommands(default)", await bot.setMyCommands([{ command: "start", description: "Do‘konni ochish / Открыть магазин" }]));
  record("setMyDescription(uz)", await bot.setMyDescription("Kanselyariya va oziq-ovqat: joriy narx va qoldiq bilan. Buyurtma bering.", "uz"));
  record("setMyDescription(ru)", await bot.setMyDescription("Канцелярия и продукты с актуальными ценами и наличием. Оформите заказ.", "ru"));
  record("setMyShortDescription(uz)", await bot.setMyShortDescription("Kanselyariya va oziq-ovqat do‘koni", "uz"));
  record("setMyShortDescription(ru)", await bot.setMyShortDescription("Канцелярия и продукты", "ru"));
  return { ok: steps.every((s) => s.ok), steps };
}
