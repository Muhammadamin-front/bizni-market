import { z } from "zod";

/**
 * The admin's AI assistant (Google Gemini). Shared by the API (validation) and the admin (forms, types).
 * It is a paid add-on: `enabled` is switched on by the developer on the server, never from the admin.
 */
export interface AiStatus {
  /** Unlocked by the developer (server setting). False = the admin shows the lock and the price. */
  enabled: boolean;
  /** A Gemini key is installed on the server. Never the key itself. */
  configured: boolean;
  /** One-time price of the add-on, UZS. */
  priceUzs: number;
  /** Where to pay / ask to unlock; may be empty. */
  contact: string;
  /** Tokens allowed per calendar month (Tashkent time), tokens used this month, and what is left. */
  limit: number;
  used: number;
  remaining: number;
  /** This month's requests (all features). */
  requests: number;
  /** YYYY-MM-DD: when the monthly allowance starts again. */
  resetsOn: string;
}

export const AI_LANGS = ["uz", "ru"] as const;
export type AiLang = (typeof AI_LANGS)[number];

/** "Write a description": what the admin has typed so far about the product. */
export const AiDescribeInput = z.object({
  name: z.string().trim().max(200).default(""),
  nameRu: z.string().trim().max(200).default(""),
  brand: z.string().trim().max(80).default(""),
  category: z.string().trim().max(200).default(""),
  /** Anything the admin already wrote (either language): facts to keep. */
  notes: z.string().trim().max(3000).default(""),
}).refine((v) => (v.name || v.nameRu).length >= 2, { message: "name_required", path: ["name"] });
export type AiDescribeInput = z.infer<typeof AiDescribeInput>;

/** "Write it in both languages": the admin's own text in either language (or a mix); the answer is Uzbek + Russian. */
export const AiTranslateInput = z.object({
  name: z.string().trim().max(200).default(""),
  description: z.string().trim().max(5000).default(""),
}).refine((v) => v.name.length > 0 || v.description.length > 0, { message: "empty", path: ["description"] });
export type AiTranslateInput = z.infer<typeof AiTranslateInput>;

export interface AiBilingual {
  name: { uz: string; ru: string };
  description: { uz: string; ru: string };
}

export const AiAnalyzeInput = z.object({
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), "days").default(30),
  lang: z.enum(AI_LANGS).default("uz"),
});
export type AiAnalyzeInput = z.infer<typeof AiAnalyzeInput>;

export const AiAdviceInput = z.object({
  question: z.string().trim().min(3).max(1000),
  lang: z.enum(AI_LANGS).default("uz"),
});
export type AiAdviceInput = z.infer<typeof AiAdviceInput>;

/** A written answer (analysis or advice): plain text with simple "• " bullets, shown as is. */
export interface AiText {
  text: string;
}
