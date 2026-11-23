"use client";

import { sectionVisible, type HomePayload } from "@shop/shared";
import { Skeleton } from "@shop/ui";
import Link from "next/link";
import { CategoryArt } from "@/components/CategoryArt";
import { ProductTile } from "@/components/ProductTile";
import { useI18n } from "@/lib/i18n";
import { useFetch } from "@/lib/use-fetch";

function Rail({ title, products }: { title: string; products: HomePayload["featured"] }) {
  if (!products.length) return null;
  return (
    <section className="mt-6" aria-label={title}>
      <h2 className="mb-2 text-lead font-bold">{title}</h2>
      <ul className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {products.map((p) => (<li key={p.id} className="w-40 shrink-0 snap-start"><ProductTile product={p} /></li>))}
      </ul>
    </section>
  );
}

export default function TmaHome() {
  const { locale, messages: m, href, content } = useI18n();
  const show = (section: Parameters<typeof sectionVisible>[1]) => sectionVisible(content, section);
  const { data: home, loading, error } = useFetch<HomePayload>(`/api/v1/home?locale=${locale}`);
  if (loading && !home) return <div className="flex flex-col gap-3"><Skeleton className="h-11" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>;
  if (error || !home) return <p className="p-6 text-center text-ink-2">{m.errors.body}</p>;
  if (home.categories.length === 0) return <p className="p-6 text-center text-ink-2">{m.home.emptyBody}</p>;
  return (
    <div>
      <Link href={href("/catalog")} className="flex h-11 items-center rounded-control border border-line bg-card px-4 text-ink-2">{m.search.placeholder}</Link>
      {show("categories") ? (
      <section className="mt-5" aria-label={m.home.categories}>
        {/* Top-level sections first (stationery, computers…), each as a large tile; empty ones say "coming soon". */}
        <ul className={`grid gap-2 ${home.categories.length > 1 ? "grid-cols-2" : ""}`}>
          {home.categories.map((r) => (
            <li key={r.id}>
              <Link href={`${href("/catalog")}?category=${r.slug}`} className="flex h-full flex-col overflow-hidden rounded-card border border-line bg-card active:bg-sunken">
                <span className="relative flex h-24 items-center justify-center overflow-hidden bg-white">
                  {r.imageUrl || r.covers[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageUrl ?? r.covers[0]} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <CategoryArt name={r.name} size="md" />
                  )}
                </span>
                <span className="flex flex-1 flex-col gap-0.5 p-2.5">
                  <span className="text-small leading-tight font-semibold">{r.name}</span>
                  <span className="text-caption text-ink-2">{r.productCount > 0 ? m.home.products(r.productCount) : m.home.comingSoon}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {home.categories.some((r) => r.children.length > 0) ? (
          <ul className="mt-2 grid grid-cols-2 gap-2">
            {home.categories.flatMap((r) => r.children).slice(0, 10).map((c) => (
              <li key={c.id}>
                <Link href={`${href("/catalog")}?category=${c.slug}`} className="flex h-full items-center gap-2.5 overflow-hidden rounded-card border border-line bg-card p-2 pr-3 text-small font-medium active:bg-sunken">
                  {/* The category's own product photo (Telegram dark theme keeps photos on white, like product cards). */}
                  <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-control bg-white">
                    {c.imageUrl || c.covers[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.imageUrl ?? c.covers[0]} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                      <CategoryArt name={c.name} size="sm" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">{c.name}</span>
                  <span className="tnum text-caption text-ink-2">{c.productCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      ) : null}
      {show("featured") ? <Rail title={m.home.featured} products={home.featured} /> : null}
      {show("offers") ? <Rail title={m.home.offers} products={home.offers} /> : null}
      {show("newArrivals") ? <Rail title={m.home.newArrivals} products={home.newArrivals} /> : null}
      {show("bestsellers") ? <Rail title={m.home.bestsellers} products={home.bestsellers} /> : null}
    </div>
  );
}
