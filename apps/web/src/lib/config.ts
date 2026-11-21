"use client";

import type { PublicConfig } from "@shop/shared";
import { useEffect, useState } from "react";

let cached: PublicConfig | null = null;
let pending: Promise<PublicConfig | null> | null = null;

function fetchConfig(): Promise<PublicConfig | null> {
  pending ??= fetch("/api/v1/config")
    .then((r) => (r.ok ? (r.json() as Promise<PublicConfig>) : null))
    .then((c) => (cached = c))
    .catch(() => null);
  return pending;
}

/** Public, non-secret settings (minimum order, Turnstile site key, demo flag). Fetched once per page load. */
export function usePublicConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(cached);
  useEffect(() => {
    let alive = true;
    void fetchConfig().then((c) => alive && setConfig(c));
    return () => {
      alive = false;
    };
  }, []);
  return config;
}
