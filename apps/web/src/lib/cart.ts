"use client";

import type { Locale, ProductCardData } from "@shop/shared";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

export interface CartLine {
  productId: string;
  quantity: number;
}

const KEY = "shop.cart.v1";
const EMPTY: CartLine[] = [];
let lines: CartLine[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();
let authToken: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

const valid = (l: unknown): l is CartLine =>
  !!l && typeof l === "object" && typeof (l as CartLine).productId === "string" && typeof (l as CartLine).quantity === "number" && (l as CartLine).quantity > 0;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(parsed)) lines = parsed.filter(valid).slice(0, 100);
  } catch {
    /* private mode or corrupt value: start empty */
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* storage unavailable: the cart lives for this tab only */
  }
  if (authToken) schedulePush();
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void fetch("/api/v1/cart", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ items: lines }),
    }).catch(() => undefined);
  }, 600);
}

function setLines(next: CartLine[]) {
  lines = next.length ? next : EMPTY;
  persist();
  emit();
}

export function setQuantity(productId: string, quantity: number) {
  load();
  const rounded = Math.round(quantity * 1000) / 1000;
  const rest = lines.filter((l) => l.productId !== productId);
  setLines(rounded > 0 ? [...rest, { productId, quantity: rounded }] : rest);
}

export function clearCart() {
  setLines(EMPTY);
}

/**
 * Mini App: keep the cart on the server too, so it follows the customer between devices.
 * Merge rule: a non-empty local cart wins (it is the latest thing the customer did); otherwise the server copy is adopted.
 */
export async function startServerCartSync(token: string): Promise<void> {
  load();
  authToken = token;
  try {
    const res = await fetch("/api/v1/cart", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const server = ((await res.json()) as { items: CartLine[] }).items.filter(valid);
    if (lines.length === 0 && server.length > 0) {
      lines = server;
      try {
        localStorage.setItem(KEY, JSON.stringify(lines));
      } catch {
        /* ignore */
      }
      emit();
    } else if (lines.length > 0) {
      schedulePush();
    }
  } catch {
    /* offline: local cart still works */
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      loaded = false;
      lines = EMPTY;
      load();
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCart() {
  const current = useSyncExternalStore(
    subscribe,
    () => {
      load();
      return lines;
    },
    () => EMPTY,
  );
  const quantityOf = useCallback((id: string) => current.find((l) => l.productId === id)?.quantity ?? 0, [current]);
  return { lines: current, count: current.length, quantityOf, setQuantity, clear: clearCart };
}

/** Fresh prices and stock for what is in the cart. The browser stores only ids and quantities; it never remembers a price. Names come in `locale`. */
export function useCartProducts(cartLines: CartLine[], locale: Locale) {
  const key = cartLines.map((l) => l.productId).sort().join(",");
  const [state, setState] = useState<{ products: Map<string, ProductCardData>; loading: boolean; error: boolean }>({ products: new Map(), loading: key.length > 0, error: false });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when the inputs of this data-loading effect change is the intent
      setState({ products: new Map(), loading: false, error: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: false }));
    fetch(`/api/v1/products/by-ids?locale=${locale}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: key.split(",") }) })
      .then((r) => (r.ok ? (r.json() as Promise<ProductCardData[]>) : Promise.reject(new Error(String(r.status)))))
      .then((list) => !cancelled && setState({ products: new Map(list.map((p) => [p.id, p])), loading: false, error: false }))
      .catch(() => !cancelled && setState((s) => ({ ...s, loading: false, error: true })));
    return () => {
      cancelled = true;
    };
  }, [key, nonce, locale]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return useMemo(() => ({ ...state, reload }), [state, reload]);
}
