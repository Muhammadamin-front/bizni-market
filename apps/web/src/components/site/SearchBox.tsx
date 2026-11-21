"use client";

import type { SuggestResult } from "@shop/shared";
import { SearchField } from "@shop/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { formatPrice } from "@shop/shared";
import { useI18n } from "@/lib/i18n";

/** Search with instant suggestions (debounced). Enter goes to the full results page. */
export function SearchBox({ initial = "" }: { initial?: string }) {
  const { locale, messages, href } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (q.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when the inputs of this data-loading effect change is the intent
      setResult(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/v1/search/suggest?q=${encodeURIComponent(q.trim())}&locale=${locale}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<SuggestResult>) : null))
        .then((data) => {
          setResult(data);
          setOpen(true);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, locale]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (value: string) => {
    setOpen(false);
    router.push(`${href("/catalog")}?q=${encodeURIComponent(value.trim())}`);
  };
  const empty = !result || (result.products.length === 0 && result.categories.length === 0 && result.brands.length === 0);

  return (
    <div ref={boxRef} className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <SearchField value={q} onChange={setQ} onSubmit={go} placeholder={messages.search.placeholder} label={messages.search.label} clearLabel={messages.search.clear} />
      {open && !empty && q.trim().length >= 2 ? (
        <div id={listId} className="absolute inset-x-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-card border border-line bg-card p-2">
          {result!.categories.length > 0 ? (
            <Group title={messages.listing.suggestCategories}>
              {result!.categories.map((c) => (
                <Link key={c.slug} href={href(`/c/${c.slug}`)} onClick={() => setOpen(false)} className="block rounded-control px-3 py-2 text-body hover:bg-sunken">
                  {c.name}
                </Link>
              ))}
            </Group>
          ) : null}
          {result!.brands.length > 0 ? (
            <Group title={messages.listing.suggestBrands}>
              {result!.brands.map((b) => (
                <Link key={b.slug} href={href(`/b/${b.slug}`)} onClick={() => setOpen(false)} className="block rounded-control px-3 py-2 text-body hover:bg-sunken">
                  {b.name}
                </Link>
              ))}
            </Group>
          ) : null}
          {result!.products.length > 0 ? (
            <Group title={messages.listing.suggestProducts}>
              {result!.products.map((p) => (
                <Link key={p.id} href={href(`/p/${p.slug}`)} onClick={() => setOpen(false)} className="flex items-center justify-between gap-3 rounded-control px-3 py-2 hover:bg-sunken">
                  <span className="min-w-0 truncate text-body">{p.name}</span>
                  <span className="tnum shrink-0 text-small text-ink-2">{formatPrice(p.price, locale)}</span>
                </Link>
              ))}
            </Group>
          ) : null}
          <button type="button" onClick={() => go(q)} className="mt-1 w-full rounded-control px-3 py-2.5 text-left text-body font-semibold text-action hover:bg-sunken">
            {messages.listing.searchAll(q.trim())}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 pt-1 pb-0.5 text-caption font-semibold tracking-wide text-ink-2 uppercase">{title}</p>
      {children}
    </div>
  );
}
