"use client";

import { useCallback, useEffect, useState } from "react";

export interface AdminResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

/** All admin calls go through here: same-origin cookie session plus the CSRF header the API requires on state changes. */
export async function adminFetch<T = unknown>(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; contentType?: string } = {}): Promise<AdminResult<T>> {
  const res = await fetch(`/api/v1/admin${path}`, {
    method: init.method ?? (init.body !== undefined || init.raw ? "POST" : "GET"),
    credentials: "same-origin",
    headers: { "x-requested-with": "shop-admin", ...(init.body !== undefined ? { "Content-Type": "application/json" } : init.contentType ? { "Content-Type": init.contentType } : {}) },
    body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export function useAdminData<T>(path: string | null, deps: unknown[] = []) {
  // error = HTTP status of a failed load (the page words it in the admin's language).
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: number | null }>({ data: null, loading: !!path, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when the inputs of this data-loading effect change is the intent
    setState((s) => ({ ...s, loading: true }));
    adminFetch<T>(path).then((r) => {
      if (!alive) return;
      if (r.status === 401) return window.dispatchEvent(new Event("admin-unauthorized"));
      setState({ data: r.ok ? r.data : null, loading: false, error: r.ok ? null : r.status });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export const fmtDate = (v: string | Date | null | undefined) => (v ? new Date(v).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—");
export const currency = (lang: "uz" | "ru") => (lang === "uz" ? "soʻm" : "сум");
export const fmtMoney = (n: number, lang: "uz" | "ru") => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${currency(lang)}`;
