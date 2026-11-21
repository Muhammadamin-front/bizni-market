import { getMessages, isLocale } from "@shop/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrands } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function BrandsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = getMessages(locale);
  const brands = await getBrands();
  return (
    <div>
      <h1 className="text-title font-bold">{m.catalog.brands}</h1>
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {brands.map((b) => (
          <li key={b.id}>
            <Link href={`/${locale}/b/${b.slug}`} className="flex min-h-14 items-center justify-between gap-2 rounded-card border border-line bg-card px-4 hover:border-line-strong">
              <span className="font-medium">{b.name}</span>
              <span className="tnum text-small text-ink-2">{b.productCount}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
