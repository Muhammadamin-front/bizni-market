"use client";

import type { Locale, MeView } from "@shop/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { startServerCartSync } from "./cart";

/** The slice of Telegram.WebApp we use (https://core.telegram.org/bots/webapps). Typed here instead of pulling a framework in. */
interface TgWebApp {
  initData: string;
  initDataUnsafe?: { user?: { language_code?: string } };
  colorScheme?: "light" | "dark";
  ready(): void;
  expand(): void;
  onEvent?(event: string, cb: () => void): void;
  offEvent?(event: string, cb: () => void): void;
  HapticFeedback?: { impactOccurred(style: string): void; notificationOccurred(type: string): void };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton?: { setText(t: string): void; show(): void; hide(): void; enable(): void; disable(): void; showProgress?(): void; hideProgress?(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

type Phase = "connecting" | "ready" | "needs-telegram" | "error";

interface TmaState {
  phase: Phase;
  token: string | null;
  me: MeView | null;
  locale: Locale;
  setLocale: (l: Locale) => void;
  setMe: (m: MeView) => void;
  /** True inside a real Telegram client (not the dev stand-in): the native MainButton/BackButton are used then. */
  inTelegram: boolean;
  devMode: boolean;
}

const Ctx = createContext<TmaState>({ phase: "connecting", token: null, me: null, locale: "uz", setLocale: () => undefined, setMe: () => undefined, inTelegram: false, devMode: false });
export const useTma = () => useContext(Ctx);

const LOCALE_KEY = "shop.tma.locale";

export function haptic(kind: "light" | "success" | "error") {
  const h = window.Telegram?.WebApp?.HapticFeedback;
  if (!h) return;
  try {
    if (kind === "light") h.impactOccurred("light");
    else h.notificationOccurred(kind);
  } catch {
    /* older clients */
  }
}

export function TmaProvider({ children }: { children: (s: TmaState) => ReactNode }) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeView | null>(null);
  const [locale, setLocaleState] = useState<Locale>("uz");
  const [inTelegram, setInTelegram] = useState(false);
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LOCALE_KEY);
    } catch {
      /* ignore */
    }
    const tgLang = tg?.initDataUnsafe?.user?.language_code;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when the inputs of this data-loading effect change is the intent
    setLocaleState(stored === "ru" || stored === "uz" ? stored : tgLang?.startsWith("ru") ? "ru" : "uz");

    if (tg) {
      tg.ready();
      tg.expand();
      const applyTheme = () => document.documentElement.setAttribute("data-theme", tg.colorScheme === "dark" ? "dark" : "light");
      applyTheme();
      tg.onEvent?.("themeChanged", applyTheme);
    }

    const connect = async () => {
      try {
        const initData = tg?.initData ?? "";
        let body: Record<string, unknown> | null = null;
        if (initData) {
          body = { initData };
          setInTelegram(true);
        } else {
          const cfg = (await fetch("/api/v1/config").then((r) => r.json())) as { tmaDevMode?: boolean };
          if (!cfg.tmaDevMode) return setPhase("needs-telegram");
          body = { dev: true };
          setDevMode(true);
        }
        const res = await fetch("/api/v1/auth/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) return setPhase(initData ? "error" : "needs-telegram");
        const data = (await res.json()) as { token: string; me: MeView };
        setToken(data.token);
        setMe(data.me);
        if (!stored) setLocaleState(data.me.language);
        setPhase("ready");
        void startServerCartSync(data.token);
      } catch {
        setPhase("error");
      }
    };
    void connect();
  }, []);

  const setLocale = useCallback(
    (l: Locale) => {
      setLocaleState(l);
      try {
        localStorage.setItem(LOCALE_KEY, l);
      } catch {
        /* ignore */
      }
      if (token) void fetch("/api/v1/me", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ language: l }) }).catch(() => undefined);
    },
    [token],
  );

  const value = useMemo<TmaState>(() => ({ phase, token, me, locale, setLocale, setMe, inTelegram, devMode }), [phase, token, me, locale, setLocale, inTelegram, devMode]);
  return <Ctx.Provider value={value}>{children(value)}</Ctx.Provider>;
}

/** Native Telegram MainButton while mounted; does nothing outside Telegram (the page shows its own button there). */
export function useMainButton(opts: { text: string; onClick: () => void; disabled?: boolean; busy?: boolean } | null) {
  const cb = useRef(opts?.onClick);
  useEffect(() => {
    cb.current = opts?.onClick;
  });
  const active = !!opts && !!window.Telegram?.WebApp?.MainButton;
  const text = opts?.text;
  const disabled = opts?.disabled;
  const busy = opts?.busy;
  useEffect(() => {
    const mb = window.Telegram?.WebApp?.MainButton;
    if (!mb || !active || text === undefined) return;
    const handler = () => cb.current?.();
    mb.setText(text);
    mb.onClick(handler);
    mb.show();
    if (disabled || busy) mb.disable();
    else mb.enable();
    if (busy) mb.showProgress?.();
    else mb.hideProgress?.();
    return () => {
      mb.offClick(handler);
      mb.hide();
    };
  }, [active, text, disabled, busy]);
  return active;
}

export function useBackButton(visible: boolean, onBack: () => void) {
  const cb = useRef(onBack);
  useEffect(() => {
    cb.current = onBack;
  });
  useEffect(() => {
    const bb = window.Telegram?.WebApp?.BackButton;
    if (!bb) return;
    const handler = () => cb.current();
    if (visible) {
      bb.show();
      bb.onClick(handler);
    } else bb.hide();
    return () => bb.offClick(handler);
  }, [visible]);
}
