"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface Favorites {
  /** True only inside the Mini App, where a signed-in Telegram customer exists. */
  enabled: boolean;
  has: (id: string) => boolean;
  set: (id: string, on: boolean) => void;
}

const Ctx = createContext<Favorites>({ enabled: false, has: () => false, set: () => undefined });

export function FavoritesProvider({ token, children }: { token: string | null; children: ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/v1/favorites/ids", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? (r.json() as Promise<string[]>) : []))
      .then((list) => !cancelled && setIds(new Set(list)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  const set = useCallback(
    (id: string, on: boolean) => {
      if (!token) return;
      setIds((s) => {
        const next = new Set(s);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
      void fetch(`/api/v1/favorites/${id}`, { method: on ? "PUT" : "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    },
    [token],
  );

  const value = useMemo<Favorites>(() => ({ enabled: !!token, has: (id) => ids.has(id), set }), [token, ids, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useFavorites = () => useContext(Ctx);
