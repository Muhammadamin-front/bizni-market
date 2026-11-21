import { ru } from "./ru";
import type { Locale, Messages } from "./types";
import { uz } from "./uz";

export * from "./types";

const catalogs: Record<Locale, Messages> = { uz, ru };

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}
