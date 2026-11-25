import { aiUsage, sql } from "@shop/db";
import type { AiAdviceInput, AiAnalyzeInput, AiBilingual, AiDescribeInput, AiLang, AiStatus, AiText, AiTranslateInput } from "@shop/shared";
import { z } from "zod";
import type { Runtime } from "./runtime";
import { loadSettings } from "./settings";
import { salesStats } from "./stats";

/**
 * The admin's AI assistant on Google Gemini: product descriptions, Uzbek ⇄ Russian, sales analysis, advice.
 *
 * - A paid add-on. AI_ENABLED (server env, set by the developer after payment) unlocks it; the owner cannot from the admin.
 * - Every call is counted in ai_usage (tokens from Gemini's own usageMetadata) and refused once the monthly allowance
 *   (AI_MONTHLY_TOKEN_LIMIT, calendar month in Tashkent time) is used up.
 * - Only the admin's own texts and aggregated shop numbers are sent. Never customer names, phones or addresses.
 * - The key goes in a header, never in the URL, and is never logged or returned.
 */

type Rt = Pick<Runtime, "db" | "env" | "log">;
export type AiFeature = "describe" | "translate" | "analyze" | "advice";

export type AiErrorCode = "ai_locked" | "ai_not_configured" | "ai_bad_key" | "ai_limit" | "ai_busy" | "ai_timeout" | "ai_failed";
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly status: number,
    message: string = code,
  ) {
    super(message);
    this.name = "AiError";
  }
}

const TZ = "Asia/Tashkent";
/** Under the web proxy's timeout (next.config experimental.proxyTimeout), so the admin gets our answer, not a proxy error. */
const CALL_TIMEOUT_MS = 55_000;
const MONTH_START = sql`(date_trunc('month', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ})`;

// ------------------------------------------------------------------------------------------------ status & limit

export async function aiStatus(rt: Rt): Promise<AiStatus> {
  const [row] = (
    await rt.db.execute(sql`SELECT COALESCE(sum(total_tokens), 0)::float8 AS used, count(*)::int AS requests,
        to_char((date_trunc('month', now() AT TIME ZONE ${TZ}) + interval '1 month')::date, 'YYYY-MM-DD') AS resets_on
      FROM ai_usage WHERE created_at >= ${MONTH_START}`)
  ).rows as { used: number; requests: number; resets_on: string }[];
  const limit = rt.env.AI_MONTHLY_TOKEN_LIMIT;
  const used = Number(row?.used ?? 0);
  return {
    enabled: rt.env.AI_ENABLED,
    configured: rt.env.GEMINI_API_KEY.length > 0,
    priceUzs: rt.env.AI_PRICE_UZS,
    contact: rt.env.AI_CONTACT,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    requests: row?.requests ?? 0,
    resetsOn: row?.resets_on ?? "",
  };
}

/** Locked, no key, or the month's tokens are spent: refused before anything is sent to Google. */
async function assertReady(rt: Rt): Promise<void> {
  if (!rt.env.AI_ENABLED) throw new AiError("ai_locked", 403, "The AI assistant is not unlocked for this shop.");
  if (!rt.env.GEMINI_API_KEY) throw new AiError("ai_not_configured", 503, "No Gemini key is installed on the server.");
  const s = await aiStatus(rt);
  if (s.remaining <= 0) throw new AiError("ai_limit", 429, "This month's AI allowance is used up.");
}

// ------------------------------------------------------------------------------------------------ the Gemini call

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
  modelVersion?: string;
  error?: { code?: number; status?: string; message?: string };
}

interface Call<T> {
  feature: AiFeature;
  system: string;
  prompt: string;
  json?: boolean;
  maxOutputTokens: number;
  temperature?: number;
  /** Turns the model's text into the result; throwing marks the call as failed (its tokens still count). */
  parse: (text: string, finishReason: string) => T;
}

async function gemini<T>(rt: Rt, adminId: string | null, call: Call<T>): Promise<T> {
  await assertReady(rt);
  const model = rt.env.GEMINI_MODEL;
  let res: Response;
  try {
    res = await fetch(`${rt.env.GEMINI_BASE_URL.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": rt.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: call.system }] },
        contents: [{ role: "user", parts: [{ text: call.prompt }] }],
        generationConfig: { maxOutputTokens: call.maxOutputTokens, temperature: call.temperature ?? 0.4, ...(call.json ? { responseMimeType: "application/json" } : {}) },
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (err) {
    const e = err as Error;
    const timedOut = e.name === "TimeoutError" || e.name === "AbortError";
    rt.log.warn({ feature: call.feature, err: e.message }, "gemini request failed");
    throw new AiError(timedOut ? "ai_timeout" : "ai_failed", timedOut ? 504 : 502);
  }
  const body = (await res.json().catch(() => null)) as GeminiResponse | null;
  if (!res.ok) {
    const message = body?.error?.message ?? "";
    rt.log.warn({ feature: call.feature, status: res.status, error: body?.error?.status, message: message.slice(0, 300) }, "gemini answered with an error");
    if (res.status === 429) throw new AiError("ai_busy", 429, "Gemini's own quota is used up for now.");
    if (res.status === 401 || res.status === 403 || /api key/i.test(message)) throw new AiError("ai_bad_key", 503, "Gemini refused the key.");
    throw new AiError("ai_failed", 502);
  }

  const usage = body?.usageMetadata ?? {};
  const promptTokens = usage.promptTokenCount ?? 0;
  const outputTokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  const totalTokens = usage.totalTokenCount ?? promptTokens + outputTokens;
  const candidate = body?.candidates?.[0];
  const finishReason = candidate?.finishReason ?? "";
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();

  let problem = "";
  let result: T | undefined;
  if (!candidate) problem = `blocked:${body?.promptFeedback?.blockReason ?? "no_answer"}`;
  else if (!text) problem = `empty:${finishReason || "?"}`;
  else if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") problem = `finish:${finishReason}`;
  else {
    try {
      result = call.parse(text, finishReason);
    } catch {
      problem = finishReason === "MAX_TOKENS" ? "cut_off" : "bad_format";
    }
  }
  await rt.db.insert(aiUsage).values({ adminId, feature: call.feature, model: body?.modelVersion ?? model, promptTokens, outputTokens, totalTokens, ok: !problem, error: problem });
  if (problem || result === undefined) {
    rt.log.warn({ feature: call.feature, problem }, "gemini answer not usable");
    throw new AiError("ai_failed", 502, problem);
  }
  return result;
}

// ------------------------------------------------------------------------------------------------ text helpers

const UZ_RULE = "Uzbek is written in the Latin script with the letters ʻ (oʻ, gʻ) and the sign ʼ, as on the shop's site.";
const langName = (lang: AiLang) => (lang === "uz" ? `Uzbek. ${UZ_RULE}` : "Russian.");

/** Gemini sometimes wraps JSON in a code fence even when asked not to. */
function parseJson<S extends z.ZodType>(text: string, schema: S): z.infer<S> {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return schema.parse(JSON.parse(clean));
}

/** The admin shows answers as plain text: markdown marks become plain text, list marks become "• ". */
function plain(text: string, finishReason: string): string {
  const out = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return finishReason === "MAX_TOKENS" ? `${out}…` : out;
}

const Pair = z.object({ uz: z.string(), ru: z.string() });

async function shopSections(rt: Rt): Promise<string> {
  const rows = (
    await rt.db.execute(sql`SELECT COALESCE(i.name, c.name) AS name FROM categories c LEFT JOIN category_i18n i ON i.category_id = c.id AND i.locale = 'uz'
      WHERE c.parent_id IS NULL AND c.archived = false ORDER BY c.sort_order, c.name LIMIT 12`)
  ).rows as { name: string }[];
  return rows.length ? rows.map((r) => r.name).join(", ") : "computers, computer services and stationery";
}

// ------------------------------------------------------------------------------------------------ features

/** A product description in both languages, from the name and whatever the admin already knows. Fills the form; never saves. */
export async function aiDescribe(rt: Rt, adminId: string | null, input: AiDescribeInput): Promise<{ uz: string; ru: string }> {
  const sections = await shopSections(rt);
  return gemini(rt, adminId, {
    feature: "describe",
    json: true,
    maxOutputTokens: 4096,
    temperature: 0.6,
    system: [
      `You write product descriptions for an online shop in Uzbekistan (sections: ${sections}).`,
      "Write one helpful, factual description for the product page, in Uzbek and in Russian with the same content.",
      "Rules:",
      "- A short opening sentence, then 3–6 lines that start with \"• \" (what it is, what it is good for, what is in the box if known). 350–900 characters per language.",
      "- Use only the facts given (name, brand, category, the admin's notes) and widely known general facts about this kind of product.",
      "- Never invent exact specifications, model numbers, sizes, capacities, warranty, prices or delivery terms that are not given.",
      "- No exaggerated advertising, no emojis, no markdown (no ** or #).",
      `- ${UZ_RULE} Russian is standard Russian.`,
      'Answer only with JSON: {"uz": "...", "ru": "..."}',
    ].join("\n"),
    prompt: [
      `Name (Uzbek): ${input.name || "—"}`,
      `Name (Russian): ${input.nameRu || "—"}`,
      `Brand: ${input.brand || "—"}`,
      `Category: ${input.category || "—"}`,
      "Admin's notes (facts to keep):",
      input.notes || "—",
    ].join("\n"),
    parse: (text) => {
      const v = parseJson(text, Pair);
      if (!v.uz.trim() || !v.ru.trim()) throw new Error("empty");
      return { uz: v.uz.trim(), ru: v.ru.trim() };
    },
  });
}

/** The admin's own name / description (Uzbek, Russian or a mix) written in both languages, facts unchanged. */
export async function aiTranslate(rt: Rt, adminId: string | null, input: AiTranslateInput): Promise<AiBilingual> {
  const out = await gemini(rt, adminId, {
    feature: "translate",
    json: true,
    maxOutputTokens: 8192,
    temperature: 0.2,
    system: [
      "You translate product texts for an online shop in Uzbekistan. The admin wrote a product name and/or description in Uzbek or Russian (sometimes mixed, with typos).",
      "Give the same text in both Uzbek and Russian.",
      "Rules:",
      "- Keep the meaning and every fact exactly. Do not add, remove or embellish anything.",
      "- Fix only spelling and obvious typos. Keep line breaks and \"• \" lines.",
      "- Keep brand names, model codes, numbers and units unchanged.",
      `- ${UZ_RULE}`,
      "- An empty input stays an empty string in both languages.",
      'Answer only with JSON: {"name": {"uz": "...", "ru": "..."}, "description": {"uz": "...", "ru": "..."}}',
    ].join("\n"),
    prompt: `Name:\n<<<\n${input.name}\n>>>\n\nDescription:\n<<<\n${input.description}\n>>>`,
    parse: (text) => parseJson(text, z.object({ name: Pair, description: Pair })),
  });
  const pick = (given: string, v: { uz: string; ru: string }) => (given ? { uz: v.uz.trim(), ru: v.ru.trim() } : { uz: "", ru: "" });
  return { name: pick(input.name, out.name), description: pick(input.description, out.description) };
}

/** The numbers the analysis and the advice are based on: aggregates only, no customer data. */
async function shopFacts(rt: Rt, days: number) {
  const settings = await loadSettings(rt);
  const stats = await salesStats(rt, days);
  const [catalog] = (
    await rt.db.execute(sql`SELECT
        count(*) FILTER (WHERE p.price > 0 AND COALESCE(o.hidden, false) = false)::int AS on_sale,
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id AND pi.status = 'ready'))::int AS without_photo,
        count(*) FILTER (WHERE p.name_ru = '')::int AS without_russian_name,
        count(*) FILTER (WHERE p.description = '')::int AS without_description,
        count(*) FILTER (WHERE p.popularity = 0)::int AS never_ordered,
        count(*)::int AS total
      FROM products p LEFT JOIN product_overlays o ON o.product_id = p.id WHERE p.archived = false`)
  ).rows as Record<string, number>[];
  const lowStock = (
    await rt.db.execute(sql`SELECT p.name, p.available_qty::float8 AS left_in_stock, p.popularity AS times_ordered
      FROM products p LEFT JOIN product_overlays o ON o.product_id = p.id
      WHERE p.archived = false AND p.price > 0 AND COALESCE(o.hidden, false) = false AND p.available_qty <= ${settings.lowStockThreshold}
      ORDER BY p.popularity DESC, p.available_qty ASC LIMIT 10`)
  ).rows;
  return {
    period_days: stats.days,
    money_unit: "UZS (soʻm)",
    revenue: stats.revenue,
    revenue_all_time: stats.revenueAllTime,
    confirmed_orders: stats.soldOrders,
    average_check: stats.averageCheck,
    units_sold: stats.unitsSold,
    waiting_for_confirmation: stats.awaiting,
    cancelled: stats.cancelled,
    revenue_by_channel: { website: stats.byChannel.web, telegram_mini_app: stats.byChannel.tma },
    daily: stats.daily.filter((d) => d.orders > 0).map((d) => [d.day, d.revenue, d.orders]),
    top_products: stats.topProducts,
    stock_left: stats.stock,
    low_stock_products: lowStock,
    catalogue: catalog ?? {},
  };
}

export async function aiAnalyzeSales(rt: Rt, adminId: string | null, input: AiAnalyzeInput): Promise<AiText> {
  const [sections, facts] = await Promise.all([shopSections(rt), shopFacts(rt, input.days)]);
  const text = await gemini(rt, adminId, {
    feature: "analyze",
    maxOutputTokens: 8192,
    system: [
      `You are a retail analyst for the owner of a small online shop in Uzbekistan (sections: ${sections}). Orders come from the website and a Telegram Mini App.`,
      `Write in ${langName(input.lang)}`,
      "Use only the numbers given. Where there is too little data to conclude something, say so plainly instead of guessing.",
      "Structure: four short parts, each with its own title line: 1) the overall picture, 2) what goes well, 3) what needs attention, 4) 3–5 concrete actions for the coming weeks.",
      "Lines in lists start with \"• \". Plain text: no markdown, no tables, no emojis. Under 2500 characters. Money as e.g. 1 250 000 soʻm.",
    ].join("\n"),
    prompt: `Shop data (JSON):\n${JSON.stringify(facts)}`,
    parse: plain,
  });
  return { text };
}

export async function aiAdvice(rt: Rt, adminId: string | null, input: AiAdviceInput): Promise<AiText> {
  const [sections, facts] = await Promise.all([shopSections(rt), shopFacts(rt, 30)]);
  const text = await gemini(rt, adminId, {
    feature: "advice",
    maxOutputTokens: 4096,
    temperature: 0.6,
    system: [
      `You are a practical e-commerce adviser for the owner of a small online shop in Uzbekistan (sections: ${sections}).`,
      "The owner manages everything in an admin panel: products, categories, banners, site texts and design, orders, statistics, and a Telegram bot with a Mini App.",
      `Answer in ${langName(input.lang)}`,
      "Be concrete and brief: steps the owner can take themselves, in order. Use the shop facts when they matter; never invent facts about the shop.",
      "Lines in lists start with \"• \". Plain text: no markdown, no emojis. Under 1800 characters.",
    ].join("\n"),
    prompt: `Shop facts, last 30 days (JSON):\n${JSON.stringify(facts)}\n\nThe owner's question:\n${input.question}`,
    parse: plain,
  });
  return { text };
}
