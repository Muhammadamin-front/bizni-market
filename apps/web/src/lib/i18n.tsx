"use client";

import { getMessages, type Locale, type Messages } from "@shop/shared";
import { createContext, useContext, useMemo, type ReactNode } from "react";

interface I18n {
  locale: Locale;
  messages: Messages;
  /** Prefixes a site path with the locale: href("/catalog") -> "/uz/catalog". */
  href: (path: string) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ locale, prefix, children }: { locale: Locale; /** "" for the site (locale-first URLs), "/tma" for the Mini App. */ prefix: string; children: ReactNode }) {
  const value = useMemo<I18n>(() => ({ locale, messages: getMessages(locale), href: (path) => `${prefix}${path === "/" ? "" : path}` || "/" }), [locale, prefix]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}

export function setLocaleCookie(locale: Locale) {
  try {
    document.cookie = `shop_locale=${locale}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* cookies blocked: the URL still carries the locale */
  }
}
