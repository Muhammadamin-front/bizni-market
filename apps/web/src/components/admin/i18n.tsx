"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * Admin language (Uzbek or Russian). Every admin text is written in place as t("русский", "oʻzbekcha"), so both versions sit
 * next to each other in the code. The choice is remembered per browser; the first visit opens in Uzbek.
 */
export type AdminLang = "uz" | "ru";
export const DEFAULT_ADMIN_LANG: AdminLang = "uz";
const KEY = "admin_lang";

let current: AdminLang | null = null;
const listeners = new Set<() => void>();

function read(): AdminLang {
  if (current) return current;
  try {
    const v = window.localStorage.getItem(KEY);
    current = v === "uz" || v === "ru" ? v : DEFAULT_ADMIN_LANG;
  } catch {
    current = DEFAULT_ADMIN_LANG;
  }
  return current;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = null;
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function setAdminLang(lang: AdminLang) {
  current = lang;
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {
    // Private mode or blocked storage: the choice still holds until the tab is closed.
  }
  listeners.forEach((f) => f());
}

export function useAdminLang(): AdminLang {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_ADMIN_LANG);
}

export type T = ((ru: string, uz: string) => string) & { lang: AdminLang };

/** t("Товары", "Tovarlar") → the text in the admin's current language. */
export function useT(): T {
  const lang = useAdminLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return useMemo(() => Object.assign((ru: string, uz: string) => (lang === "uz" ? uz : ru), { lang }), [lang]);
}

/** A {ru, uz} pair, for tables of labels that live outside components. */
export type L = { ru: string; uz: string };

export function LangSwitch({ className = "" }: { className?: string }) {
  const lang = useAdminLang();
  return (
    <div role="group" aria-label="Til / Язык" className={`inline-flex shrink-0 overflow-hidden rounded-control border border-line text-caption font-semibold ${className}`}>
      {(["uz", "ru"] as const).map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => setAdminLang(l)} className={`px-2.5 py-1 ${lang === l ? "bg-ink text-on-ink" : "bg-card text-ink-2 hover:bg-sunken hover:text-ink"}`}>
          {l === "uz" ? "UZ" : "RU"}
        </button>
      ))}
    </div>
  );
}
