"use client";

import type { CatalogPage, CategoryNode, ProductCardData } from "@shop/shared";
import { Button, Chip, EmptyState, ProductCardSkeleton, SearchField } from "@shop/ui";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ProductGrid } from "@/components/ProductTile";
import { CategoryBrowser } from "@/components/site/CategoryBrowser";
import { useI18n } from "@/lib/i18n";

function Catalog() {
  const { locale, messages: m } = useI18n();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [applied, setApplied] = useState(params.get("q") ?? "");
  const category = params.get("category") ?? "";
  const [roots, setRoots] = useState<CategoryNode[]>([]);
  const [sort, setSort] = useState("popular");
  const [inStock, setInStock] = useState(false);
  const [items, setItems] = useState<ProductCardData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  // Same flow as the website catalogue: the category list first, products once a category (or a search) is picked.
  const showCategories = !category && !applied;

  useEffect(() => {
    fetch(`/api/v1/categories?locale=${locale}&empty=1`)
      .then((r) => (r.ok ? (r.json() as Promise<CategoryNode[]>) : Promise.reject(new Error())))
      .then(setRoots)
      .catch(() => undefined);
  }, [locale]);

  // Debounce typing into the query that is actually requested.
  useEffect(() => {
    const t = setTimeout(() => setApplied(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when the inputs of this data-loading effect change is the intent
    setPage(1);
  }, [applied, sort, inStock, category]);

  useEffect(() => {
    if (showCategories) return;
    const ctrl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when the inputs of this data-loading effect change is the intent
    setLoading(true);
    setError(false);
    const p = new URLSearchParams({ page: String(page), pageSize: "24", sort, locale });
    if (applied) p.set("q", applied);
    if (category) p.set("category", category);
    if (inStock) p.set("inStock", "1");
    fetch(`/api/v1/catalog/products?${p}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<CatalogPage>) : Promise.reject(new Error())))
      .then((d) => {
        setItems((prev) => (page === 1 ? d.items : [...prev, ...d.items]));
        setTotal(d.total);
        setLoading(false);
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          setError(true);
          setLoading(false);
        }
      });
    return () => ctrl.abort();
  }, [page, applied, sort, inStock, category, locale, showCategories]);

  // Infinite scroll: ask for the next page when the sentinel nears the viewport.
  const more = !showCategories && items.length < total;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || loading) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && setPage((n) => n + 1), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, loading, items.length]);

  return (
    <div>
      <SearchField value={q} onChange={setQ} onSubmit={(v) => setApplied(v.trim())} placeholder={m.search.placeholder} label={m.search.label} clearLabel={m.search.clear} />
      {showCategories ? (
        <div className="mt-3">
          <CategoryBrowser roots={roots} locale={locale} basePath="/tma/catalog" />
        </div>
      ) : (
        <>
      {category ? (
        <Link href="/tma/catalog" className="mt-3 inline-flex items-center gap-1 text-small font-semibold text-link">
          <ChevronLeft aria-hidden className="size-4" />
          {m.catalog.categories}
        </Link>
      ) : null}
      <div className="-mx-3 mt-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip selected={inStock} onClick={() => setInStock(!inStock)}>{m.catalog.inStockOnly}</Chip>
        {([["popular", m.catalog.sortPopular], ["new", m.catalog.sortNew], ["price_asc", m.catalog.sortPriceAsc], ["price_desc", m.catalog.sortPriceDesc]] as const).map(([v, l]) => (
          <Chip key={v} selected={sort === v} onClick={() => setSort(v)}>{l}</Chip>
        ))}
      </div>
      <p className="mt-3 text-small text-ink-2" aria-live="polite">{m.catalog.results(total)}</p>
      <div className="mt-2">
        {error ? (
          <EmptyState title={m.errors.title} body={m.errors.body} action={<Button onClick={() => setPage(1)}>{m.errors.retry}</Button>} />
        ) : items.length === 0 && !loading ? (
          <EmptyState title={m.states.emptyTitle} body={m.states.emptyBody} />
        ) : (
          <ProductGrid products={items} withFavorite />
        )}
        {loading ? <div className="mt-3 grid grid-cols-2 gap-3"><ProductCardSkeleton /><ProductCardSkeleton /></div> : null}
        <div ref={sentinel} className="h-1" />
      </div>
        </>
      )}
    </div>
  );
}

export default function TmaCatalog() {
  return (
    <Suspense>
      <Catalog />
    </Suspense>
  );
}
