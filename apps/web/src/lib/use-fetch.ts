"use client";

import { useEffect, useState } from "react";

/** Client-side GET of our own public API (Mini App pages are client-rendered). */
export function useFetch<T>(url: string | null, headers?: Record<string, string>): { data: T | null; loading: boolean; error: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: boolean }>({ data: null, loading: !!url, error: false });
  const [tick, setTick] = useState(0);
  const auth = headers?.Authorization;
  useEffect(() => {
    if (!url) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when the inputs of this data-loading effect change is the intent
    setState((s) => ({ ...s, loading: true, error: false }));
    fetch(url, { headers: auth ? { Authorization: auth } : undefined })
      .then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => alive && setState({ data, loading: false, error: false }))
      .catch(() => alive && setState((s) => ({ ...s, loading: false, error: true })));
    return () => {
      alive = false;
    };
  }, [url, auth, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
