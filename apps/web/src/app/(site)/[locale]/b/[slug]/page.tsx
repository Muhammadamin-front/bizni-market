import { isLocale } from "@shop/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing } from "@/components/site/Listing";
import { getBrands } from "@/lib/server-api";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const brand = (await getBrands()).find((b) => b.slug === slug);
  return { title: brand?.name, alternates: { canonical: `/${locale}/b/${slug}` } };
}

export default async function BrandPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const brand = (await getBrands()).find((b) => b.slug === slug);
  if (!brand) notFound();
  return <Listing locale={locale} searchParams={await searchParams} fixed={{ brand: slug }} basePath={`/${locale}/b/${slug}`} heading={brand.name} />;
}
