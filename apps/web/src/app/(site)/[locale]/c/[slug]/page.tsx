import { getMessages, isLocale } from "@shop/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Listing } from "@/components/site/Listing";
import { getCategory } from "@/lib/server-api";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const found = await getCategory(slug, locale);
  const sp = await searchParams;
  const filtered = Object.keys(sp).some((k) => k !== "page");
  return { title: found?.node.name, robots: filtered ? { index: false, follow: true } : undefined, alternates: { canonical: `/${locale}/c/${slug}`, languages: { uz: `/uz/c/${slug}`, ru: `/ru/c/${slug}` } } };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const found = await getCategory(slug, locale);
  if (!found) notFound();
  const m = getMessages(locale);
  return (
    <Listing
      locale={locale}
      searchParams={await searchParams}
      fixed={{ category: slug }}
      basePath={`/${locale}/c/${slug}`}
      heading={found.node.name}
      breadcrumb={
        <nav aria-label={m.listing.breadcrumbs} className="mb-2 text-small text-ink-2">
          <ol className="flex flex-wrap gap-1.5">
            <li><Link href={`/${locale}/catalog`} className="hover:underline">{m.nav.catalog}</Link></li>
            {found.path.map((p, i) => (
              <li key={p.slug} className="flex gap-1.5">
                <span aria-hidden>/</span>
                {i === found.path.length - 1 ? <span aria-current="page" className="text-ink">{p.name}</span> : <Link href={`/${locale}/c/${p.slug}`} className="hover:underline">{p.name}</Link>}
              </li>
            ))}
          </ol>
        </nav>
      }
    />
  );
}
