import { getMessages, isLocale } from "@shop/shared";
import { EmptyState } from "@shop/ui";
import { PackageOpen } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryTiles } from "@/components/site/CategoryTiles";
import { HeroCoverflow } from "@/components/site/HeroCoverflow";
import { Rail } from "@/components/site/Rail";
import { getHome } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = getMessages(locale);
  const home = await getHome(locale);
  const empty = home.categories.length === 0 && home.brands.length === 0;
  if (empty) return <EmptyState icon={<PackageOpen className="size-7" strokeWidth={1.5} />} title={m.home.emptyTitle} body={m.home.emptyBody} />;

  return (
    <div>
      {home.banners.some((b) => b.imageUrl) ? (
        <HeroCoverflow banners={home.banners} locale={locale} />
      ) : (
        <section className="rounded-card border border-line bg-card p-6 lg:p-10">
          <h1 className="max-w-2xl text-title font-bold text-balance lg:text-[2.5rem] lg:leading-[1.1]">{m.home.heroTitle}</h1>
          <p className="mt-3 max-w-xl text-body text-ink-2 text-pretty">{m.home.heroBody}</p>
          <Link href={`/${locale}/catalog`} className="mt-5 inline-flex h-11 items-center rounded-control bg-action px-5 font-semibold text-white hover:bg-action-press">
            {m.nav.catalog}
          </Link>
        </section>
      )}
      {home.banners.some((b) => b.imageUrl) ? <h1 className="sr-only">{m.home.heroTitle}</h1> : null}

      <CategoryTiles roots={home.categories} locale={locale} />

      {home.brands.length > 0 ? (
        <section className="mt-10" aria-label={m.home.brands}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lead font-bold">{m.home.brands}</h2>
            <Link href={`/${locale}/brands`} className="text-small font-semibold text-action hover:underline">{m.home.allBrands}</Link>
          </div>
          <ul className="flex flex-wrap gap-2">
            {home.brands.map((b) => (
              <li key={b.id}>
                <Link href={`/${locale}/b/${b.slug}`} className="inline-flex h-10 items-center rounded-control border border-line bg-card px-4 text-small font-medium hover:border-line-strong">{b.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Rail title={m.home.featured} products={home.featured} />
      <Rail title={m.home.offers} products={home.offers} moreHref={`/${locale}/catalog?sort=price_asc`} moreLabel={m.home.viewAll} />
      <Rail title={m.home.newArrivals} products={home.newArrivals} moreHref={`/${locale}/catalog?sort=new`} moreLabel={m.home.viewAll} />
      <Rail title={m.home.bestsellers} products={home.bestsellers} />
    </div>
  );
}
