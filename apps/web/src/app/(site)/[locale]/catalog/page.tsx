import { getMessages, isLocale } from "@shop/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing } from "@/components/site/Listing";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const sp = await searchParams;
  const m = getMessages(isLocale(locale) ? locale : "uz");
  // Filtered and searched views are not worth indexing separately; the unfiltered catalogue and category pages are.
  const filtered = Object.keys(sp).some((k) => k !== "page");
  return { title: m.nav.catalog, robots: filtered ? { index: false, follow: true } : undefined, alternates: { canonical: `/${locale}/catalog` } };
}

export default async function CatalogPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <Listing locale={locale} searchParams={await searchParams} basePath={`/${locale}/catalog`} heading={getMessages(locale).nav.catalog} />;
}
