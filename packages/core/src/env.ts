import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";

const flag = (fallback = "") =>
  z
    .string()
    .default(fallback)
    .transform((v) => ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgres://shop:shop@localhost:5432/shop"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // --- MoySklad (server only). With no token the system runs, shows an empty catalogue and says so in the admin.
  MOYSKLAD_TOKEN: z.string().default(""),
  MOYSKLAD_BASE_URL: z.string().default("https://api.moysklad.ru/api/remap/1.2"),
  /** 4 = user token from 2026-12-01 (strictest); lower it to 1 only for an approved solution token. */
  MOYSKLAD_REQUEST_WEIGHT: z.coerce.number().int().min(1).max(10).default(4),
  MOYSKLAD_WEBHOOK_SECRET: z.string().default(""),

  // --- Telegram
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_BOT_USERNAME: z.string().default(""),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
  /** How old (seconds) a Mini App initData may be before it is refused. */
  TELEGRAM_INITDATA_MAX_AGE: z.coerce.number().int().min(60).default(86_400),

  // --- Public addresses
  PUBLIC_URL: z.string().default("http://localhost:3000"),
  /** Base URL MoySklad should call webhooks on, when it differs from PUBLIC_URL (e.g. the internal address in the demo). */
  MOYSKLAD_WEBHOOK_BASE_URL: z.string().default(""),
  API_PORT: z.coerce.number().int().default(4000),
  /** Address the API listens on. 0.0.0.0 inside Docker; 127.0.0.1 on a shared host where only the local web app may reach it. */
  API_HOST: z.string().default("0.0.0.0"),
  API_INTERNAL_URL: z.string().default("http://localhost:4000"),

  SESSION_SECRET: z.string().default(""),
  MEDIA_DIR: z.string().default("./data/media"),

  // --- First admin (created on boot if no admin exists)
  ADMIN_EMAIL: z.string().default(""),
  ADMIN_PASSWORD: z.string().default(""),

  // --- Abuse protection
  TURNSTILE_SECRET: z.string().default(""),
  TURNSTILE_SITE_KEY: z.string().default(""),
  TRUST_PROXY: flag("true"),
  /**
   * Header that carries the real client address, set by the edge in front of us (e.g. "cf-connecting-ip" behind Cloudflare Tunnel).
   * Only for hosts where nothing else can reach the app: the header is then trusted as is. Empty = the address from X-Forwarded-For.
   */
  CLIENT_IP_HEADER: z.string().default(""),

  // --- Web revalidation after sync
  WEB_REVALIDATE_URL: z.string().default(""),
  REVALIDATE_SECRET: z.string().default(""),

  /** Open the Mini App in a plain browser with a stand-in user. Refused in production when a real bot token is set. */
  TMA_DEV_MODE: flag(),

  // --- AI assistant (Google Gemini). A paid add-on: locked until the developer turns it on here after payment; the owner
  // cannot unlock it from the admin. The key lives only in this file (never in the database, the admin or a URL).
  AI_ENABLED: flag(),
  GEMINI_API_KEY: z.string().default(""),
  /** "-latest" alias: Google moves it to the newest Flash model, so nothing here goes stale. */
  GEMINI_MODEL: z.string().default("gemini-flash-latest"),
  GEMINI_BASE_URL: z.string().default("https://generativelanguage.googleapis.com/v1beta"),
  /** Gemini tokens the shop may spend per calendar month (Tashkent time). Shown to the owner as used / limit. */
  AI_MONTHLY_TOKEN_LIMIT: z.coerce.number().int().min(0).default(1_000_000),
  /** One-time price shown on the locked AI button, in UZS. */
  AI_PRICE_UZS: z.coerce.number().int().min(0).default(300_000),
  /** Where the owner pays / asks to unlock (e.g. https://t.me/username or a phone). Shown on the locked card. */
  AI_CONTACT: z.string().default(""),
  SYNC_ON_BOOT: flag("true"),
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof EnvSchema> & { webhookBaseUrl: string };

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.parse(source);
  const isProd = parsed.NODE_ENV === "production";

  if (isProd && parsed.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 random characters in production (e.g. `openssl rand -hex 32`).");
  }
  if (parsed.TMA_DEV_MODE && isProd && parsed.TELEGRAM_BOT_TOKEN) {
    throw new Error("TMA_DEV_MODE must not be enabled in production together with a real TELEGRAM_BOT_TOKEN: it would bypass Telegram authentication.");
  }
  if (isProd && parsed.ADMIN_PASSWORD && parsed.ADMIN_PASSWORD.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters in production.");
  }

  if (!path.isAbsolute(parsed.MEDIA_DIR)) {
    // The API serves what the worker writes. Two processes with different working directories would resolve a relative path to two
    // different folders and the catalogue would show broken images. Make it explicit instead of silently wrong.
    console.warn(`MEDIA_DIR ("${parsed.MEDIA_DIR}") is relative: api and worker must share ONE absolute folder.`);
  }

  return {
    ...parsed,
    SESSION_SECRET: parsed.SESSION_SECRET || (isProd ? "" : randomBytes(32).toString("hex")),
    webhookBaseUrl: (parsed.MOYSKLAD_WEBHOOK_BASE_URL || parsed.PUBLIC_URL).replace(/\/$/, ""),
  };
}

/**
 * True while the catalogue comes from something other than the real MoySklad cloud (the synthetic mock).
 * With no token there is no MoySklad at all: the catalogue is the owner's own, typed in the admin, so it is real, not a demo.
 */
export function isDemoSource(env: Pick<Env, "MOYSKLAD_BASE_URL" | "MOYSKLAD_TOKEN">): boolean {
  if (!env.MOYSKLAD_TOKEN) return false;
  try {
    return new URL(env.MOYSKLAD_BASE_URL).hostname !== "api.moysklad.ru";
  } catch {
    return true;
  }
}
