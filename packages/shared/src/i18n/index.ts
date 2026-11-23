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

/** Messages with the owner's shop name and home texts laid over the built-in defaults. */
export function getMessagesWithContent(locale: Locale, content: ContentMap | null | undefined): Messages {
  const m = getMessages(locale);
  const name = contentText(content, "brand.name", locale);
  const heroTitle = contentText(content, "home.heroTitle", locale);
  const heroBody = contentText(content, "home.heroBody", locale);
  if (!name && !heroTitle && !heroBody) return m;
  return {
    ...m,
    brand: { ...m.brand, name: name || m.brand.name },
    home: { ...m.home, heroTitle: heroTitle || m.home.heroTitle, heroBody: heroBody || m.home.heroBody },
  };
}
