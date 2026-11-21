import type { Locale } from "./i18n/types";

const NBSP = " ";

/** Currency word per locale. Uzbek uses the modifier letter turned comma (U+02BB) in "soʻm". */
const CURRENCY: Record<Locale, string> = { uz: "soʻm", ru: "сум" };

/**
 * Groups an integer amount of UZS in threes with a non-breaking space ("1 234 500").
 * Amounts are integer UZS everywhere in the app (MoySklad's hundredths are divided on ingest).
 */
export function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "−" : "";
  const digits = String(Math.abs(rounded));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** "1 500 soʻm" / "1 500 сум" — number and currency word kept on one line. */
export function formatPrice(amount: number, locale: Locale): string {
  return `${formatAmount(amount)}${NBSP}${CURRENCY[locale]}`;
}

export function currencyWord(locale: Locale): string {
  return CURRENCY[locale];
}

/** Whole percent discount of `price` against `oldPrice`, or 0 when there is no real discount. */
export function discountPercent(price: number, oldPrice: number | null | undefined): number {
  if (!oldPrice || oldPrice <= price || price < 0) return 0;
  return Math.round(((oldPrice - price) / oldPrice) * 100);
}
