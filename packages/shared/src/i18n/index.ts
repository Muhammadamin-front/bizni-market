import { ru } from "./ru";
import type { Locale, Messages } from "./types";
import { uz } from "./uz";

export * from "./types";

const catalogs: Record<Locale, Messages> = { uz, ru };

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}

/** Owner-editable texts (admin → Sayt matnlari). Each key is a content block with uz/ru values; empty means "use the default". */
export const EDITABLE_TEXT_KEYS = ["brand.name", "home.heroTitle", "home.heroBody"] as const;
export type ContentMap = Record<string, { uz: string; ru: string } | undefined>;

/** The owner's value for a content block in this locale (falling back to the other language), or "" when not set. */
export function contentText(content: ContentMap | null | undefined, key: string, locale: Locale): string {
  const block = content?.[key];
  if (!block) return "";
  return (block[locale] || block[locale === "uz" ? "ru" : "uz"] || "").trim();
}

/** A leaf of the message catalogue that the owner may rewrite: key is "t.<dotted path>", the content block that stores the override. */
export interface EditableMessage {
  key: string;
  section: string;
  uz: string;
  ru: string;
}

/** Every plain-text message (functions with a number inside, like "N products", are not editable). Same order as the catalogue. */
export function editableMessages(): EditableMessage[] {
  const out: EditableMessage[] = [];
  const walk = (a: unknown, b: unknown, path: string[]) => {
    if (typeof a === "string") {
      if (typeof b === "string") out.push({ key: `t.${path.join(".")}`, section: path[0] ?? "", uz: a, ru: b });
      return;
    }
    if (a && typeof a === "object" && b && typeof b === "object") {
      for (const k of Object.keys(a)) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], [...path, k]);
    }
  };
  walk(uz, ru, []);
  return out;
}

function cloneMessages<T>(value: T): T {
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneMessages(v)])) as T;
  return value;
}

/**
 * Messages with the owner's changes laid over the built-in defaults: shop name and home texts (older blocks), and any plain text
 * of the site stored as a "t.<path>" block (admin → Barcha matnlar). An override only replaces a text that exists and is text.
 */
export function getMessagesWithContent(locale: Locale, content: ContentMap | null | undefined): Messages {
  const m = getMessages(locale);
  if (!content) return m;
  const name = contentText(content, "brand.name", locale);
  const heroTitle = contentText(content, "home.heroTitle", locale);
  const heroBody = contentText(content, "home.heroBody", locale);
  const overrides = Object.keys(content).filter((k) => k.startsWith("t.") && content[k]?.[locale]?.trim());
  if (!name && !heroTitle && !heroBody && overrides.length === 0) return m;
  const out = cloneMessages(m) as unknown as Record<string, Record<string, unknown>>;
  for (const key of overrides) {
    const path = key.slice(2).split(".");
    const leaf = path.pop();
    let node: unknown = out;
    for (const p of path) node = node && typeof node === "object" ? (node as Record<string, unknown>)[p] : undefined;
    if (leaf && node && typeof node === "object" && typeof (node as Record<string, unknown>)[leaf] === "string") (node as Record<string, unknown>)[leaf] = content[key]![locale].trim();
  }
  const result = out as unknown as Messages;
  // Dedicated blocks win over a generic one: they are what the older admin page edits.
  if (name) result.brand.name = name;
  if (heroTitle) result.home.heroTitle = heroTitle;
  if (heroBody) result.home.heroBody = heroBody;
  return result;
}

/** Look of the site, from the owner's blocks: accent / background colours (hex) and whether a home page section is shown. */
export const HOME_SECTIONS = ["banners", "categories", "brands", "featured", "offers", "newArrivals", "bestsellers"] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function sectionVisible(content: ContentMap | null | undefined, section: HomeSection): boolean {
  return (content?.[`home.show.${section}`]?.uz ?? "") !== "0";
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * (1 + amount))));
  return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("")}`;
}

/** CSS that re-points the colour tokens to the owner's colours. Empty when none were chosen. Only validated hex values reach it. */
export function themeCss(content: ContentMap | null | undefined): string {
  const rules: string[] = [];
  const action = content?.["theme.action"]?.uz?.trim() ?? "";
  const ground = content?.["theme.ground"]?.uz?.trim() ?? "";
  if (HEX_COLOR.test(action)) rules.push(`--color-action:${action}`, `--color-action-press:${shade(action, -0.18)}`);
  if (HEX_COLOR.test(ground)) rules.push(`--color-ground:${ground}`);
  return rules.length ? `:root,html[data-theme="light"]{${rules.join(";")}}` : "";
}

/** Storage key of the owner's logo picture (admin → Sayt dizayni), or "". */
export const logoKey = (content: ContentMap | null | undefined): string => content?.["theme.logo"]?.uz?.trim() ?? "";
