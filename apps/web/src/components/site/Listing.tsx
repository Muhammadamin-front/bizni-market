import { CatalogQuery, getMessages, type Locale } from "@shop/shared";
import { EmptyState } from "@shop/ui";
import { LayoutGrid, List } from "lucide-react";
import Link from "next/link";
import { ProductGrid } from "@/components/ProductTile";
import { getBrands, getCatalog, getCategories } from "@/lib/server-api";
import { FilterPanel } from "./FilterPanel";
import { SortSelect } from "./SortSelect";

type SP = Record<string, string | string[] | undefined>;

function toParams(sp: SP, fixed: { category?: string; brand?: string }, locale: Locale): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) p.set(k, v);
  if (fixed.category) p.set("category", fixed.category);
  if (fixed.brand) p.set("brand", fixed.brand);
  p.set("locale", locale);
  return p;
}

/** The catalogue: one server-rendered view for "all", a category, a brand and search results. */
export async function Listing({ locale, searchParams, fixed = {}, basePath, heading, breadcrumb }: { locale: Locale; searchParams: SP; fixed?: { category?: string; brand?: string }; basePath: string; heading: string; breadcrumb?: React.ReactNode }) {
  const m = getMessages(locale);
  const params = toParams(searchParams, fixed, locale);
  const parsed = CatalogQuery.safeParse(Object.fromEntries(params));
  if (!parsed.success) params.delete("page");
  const [page, categories, brands] = await Promise.all([getCatalog(params), getCategories(locale), getBrands()]);
  const view = searchParams.view === "list" ? "list" : "grid";
  const q = (typeof searchParams.q === "string" ? searchParams.q : "").trim();
  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && v && k !== "locale") next.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return `${basePath}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      {breadcrumb}
      <h1 className="text-title font-bold text-balance">{q ? m.listing.resultsFor(q) : heading}</h1>
      <div className="mt-4 flex flex-col gap-6 lg:flex-row">
        <FilterPanel categories={categories} brands={brands} activeCategory={fixed.category} total={page.total} priceMin={page.priceMin} priceMax={page.priceMax} />
        <section className="min-w-0 flex-1" aria-label={heading}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-small text-ink-2" aria-live="polite">{m.catalog.results(page.total)}</p>
            <div className="flex items-center gap-2">
              <SortSelect value={page.items.length ? (searchParams.sort as string | undefined) ?? "popular" : "popular"} />
              <nav aria-label={m.catalog.viewGrid} className="hidden gap-1 md:flex">
                <Link href={link({ view: undefined })} aria-label={m.catalog.viewGrid} aria-current={view === "grid" ? "true" : undefined} className={`inline-flex size-10 items-center justify-center rounded-control border ${view === "grid" ? "border-ink bg-ink text-white" : "border-line bg-card text-ink-2 hover:text-ink"}`}>
                  <LayoutGrid aria-hidden className="size-5" />
                </Link>
                <Link href={link({ view: "list" })} aria-label={m.catalog.viewList} aria-current={view === "list" ? "true" : undefined} className={`inline-flex size-10 items-center justify-center rounded-control border ${view === "list" ? "border-ink bg-ink text-white" : "border-line bg-card text-ink-2 hover:text-ink"}`}>
                  <List aria-hidden className="size-5" />
                </Link>
              </nav>
            </div>
          </div>
          {page.items.length === 0 ? (
            <EmptyState title={m.states.emptyTitle} body={m.states.emptyBody} action={<Link href={basePath} className="inline-flex h-11 items-center rounded-control border border-line-strong bg-card px-4 font-semibold hover:bg-sunken">{m.states.clearFilters}</Link>} />
          ) : (
            <ProductGrid products={page.items} view={view} />
          )}
          {totalPages > 1 ? (
            <nav aria-label={m.listing.page(page.page, totalPages)} className="mt-8 flex items-center justify-center gap-2">
              {page.page > 1 ? (
                <Link rel="prev" href={link({ page: page.page - 1 === 1 ? undefined : String(page.page - 1) })} className="inline-flex h-11 items-center rounded-control border border-line-strong bg-card px-4 font-semibold hover:bg-sunken">{m.listing.prev}</Link>
              ) : null}
              <span className="tnum px-2 text-small text-ink-2">{page.page} / {totalPages}</span>
              {page.page < totalPages ? (
                <Link rel="next" href={link({ page: String(page.page + 1) })} className="inline-flex h-11 items-center rounded-control border border-line-strong bg-card px-4 font-semibold hover:bg-sunken">{m.listing.next}</Link>
              ) : null}
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}
