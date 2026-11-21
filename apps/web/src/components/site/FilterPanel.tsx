"use client";

import type { BrandDTO, CategoryNode } from "@shop/shared";
import { Button, CheckboxRow, FilterGroup, Sheet, TextField } from "@shop/ui";
import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

/** Filters live in the URL, so every filtered view is a shareable, crawlable, back-button-friendly page. */
export function FilterPanel({ categories, brands, activeCategory, total, priceMin, priceMax }: { categories: CategoryNode[]; brands: BrandDTO[]; activeCategory?: string; total: number; priceMin: number; priceMax: number }) {
  const { messages, href } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="lg:hidden">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <SlidersHorizontal aria-hidden className="size-4" />
          {messages.catalog.filters}
        </Button>
        <Sheet open={open} onClose={() => setOpen(false)} title={messages.catalog.filters} closeLabel={messages.listing.closeFilters} footer={<Button fullWidth onClick={() => setOpen(false)}>{messages.listing.showResults(total)}</Button>}>
          <Panel categories={categories} brands={brands} activeCategory={activeCategory} priceMin={priceMin} priceMax={priceMax} href={href} />
        </Sheet>
      </div>
      <aside className="hidden w-64 shrink-0 self-start lg:sticky lg:top-[5.5rem] lg:block lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1 [scrollbar-width:thin]" aria-label={messages.catalog.filters}>
        <Panel categories={categories} brands={brands} activeCategory={activeCategory} priceMin={priceMin} priceMax={priceMax} href={href} />
      </aside>
    </>
  );
}

function Panel({ categories, brands, activeCategory, priceMin, priceMax, href }: { categories: CategoryNode[]; brands: BrandDTO[]; activeCategory?: string; priceMin: number; priceMax: number; href: (p: string) => string }) {
  const { messages } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedBrands = new Set((params.get("brand") ?? "").split(",").filter(Boolean));
  const [from, setFrom] = useState(params.get("priceMin") ?? "");
  const [to, setTo] = useState(params.get("priceMax") ?? "");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when the inputs of this data-loading effect change is the intent
    setFrom(params.get("priceMin") ?? "");
    setTo(params.get("priceMax") ?? "");
  }, [params]);

  const push = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("page");
    const qs = next.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };
  const digits = (v: string) => v.replace(/\D/g, "");

  return (
    <div className="flex flex-col gap-6">
      <FilterGroup title={messages.listing.categoryHeading}>
        <Link href={href("/catalog")} className={`min-h-11 py-2.5 text-body ${!activeCategory ? "font-semibold" : "text-ink-2 hover:text-ink"}`}>
          {messages.listing.allCategories}
        </Link>
        {categories.map((c) => (
          <CategoryLink key={c.id} node={c} active={activeCategory} href={href} depth={0} />
        ))}
      </FilterGroup>

      <FilterGroup title={messages.catalog.priceFrom.replace(/,.*$/, "")}>
        <div className="grid grid-cols-2 gap-2">
          <TextField label={messages.catalog.priceFrom} inputMode="numeric" placeholder={String(priceMin)} value={from} onChange={(v) => setFrom(digits(v))} onBlur={() => push((p) => (from ? p.set("priceMin", from) : p.delete("priceMin")))} onKeyDown={(e) => e.key === "Enter" && push((p) => (from ? p.set("priceMin", from) : p.delete("priceMin")))} />
          <TextField label={messages.catalog.priceTo} inputMode="numeric" placeholder={String(priceMax)} value={to} onChange={(v) => setTo(digits(v))} onBlur={() => push((p) => (to ? p.set("priceMax", to) : p.delete("priceMax")))} onKeyDown={(e) => e.key === "Enter" && push((p) => (to ? p.set("priceMax", to) : p.delete("priceMax")))} />
        </div>
      </FilterGroup>

      <FilterGroup title={messages.catalog.filters}>
        <CheckboxRow label={messages.catalog.inStockOnly} checked={params.get("inStock") === "1"} onChange={(on) => push((p) => (on ? p.set("inStock", "1") : p.delete("inStock")))} />
      </FilterGroup>

      {brands.length > 0 ? (
        <FilterGroup title={messages.listing.brandHeading}>
          <div className="max-h-72 overflow-y-auto pr-1">
            {brands.slice(0, 60).map((b) => (
              <CheckboxRow
                key={b.id}
                label={b.name}
                count={b.productCount}
                checked={selectedBrands.has(b.slug)}
                onChange={(on) =>
                  push((p) => {
                    const set = new Set(selectedBrands);
                    if (on) set.add(b.slug);
                    else set.delete(b.slug);
                    if (set.size) p.set("brand", [...set].join(","));
                    else p.delete("brand");
                  })
                }
              />
            ))}
          </div>
        </FilterGroup>
      ) : null}
    </div>
  );
}

function CategoryLink({ node, active, href, depth }: { node: CategoryNode; active?: string; href: (p: string) => string; depth: number }) {
  const isActive = node.slug === active;
  const expanded = isActive || hasDescendant(node, active);
  return (
    <>
      <Link href={href(`/c/${node.slug}`)} aria-current={isActive ? "page" : undefined} style={{ paddingLeft: depth * 14 }} className={`flex min-h-11 items-center justify-between gap-2 py-2.5 text-body ${isActive ? "font-semibold" : "text-ink-2 hover:text-ink"}`}>
        <span>{node.name}</span>
        <span className="tnum text-small text-ink-2">{node.productCount}</span>
      </Link>
      {expanded ? node.children.map((c) => <CategoryLink key={c.id} node={c} active={active} href={href} depth={depth + 1} />) : null}
    </>
  );
}

function hasDescendant(node: CategoryNode, slug?: string): boolean {
  return !!slug && node.children.some((c) => c.slug === slug || hasDescendant(c, slug));
}
