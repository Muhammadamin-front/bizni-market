import { getMessages, isLocale, type ProductDetail } from "@shop/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ProductGrid } from "@/components/ProductTile";
import { ProductBuy } from "@/components/site/ProductBuy";
import { ProductGallery } from "@/components/site/ProductGallery";
import { getProduct, getRelated } from "@/lib/server-api";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; slug: string }> };

async function load(locale: "uz" | "ru", slug: string) {
  const found = await getProduct(slug, locale);
  if (!found) notFound();
  // A renamed product keeps its trailing id: the old link redirects to the new one (permanently, so search engines follow).
  if ("redirectTo" in found) permanentRedirect(`/${locale}/p/${found.redirectTo}`);
  return found as ProductDetail;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const found = await getProduct(slug, locale);
  if (!found || "redirectTo" in found) return {};
  const origin = process.env.PUBLIC_URL ?? "http://localhost:3000";
  const image = found.images[0]?.large;
  return {
    title: found.name,
    description: found.description.slice(0, 160) || `${found.name} — ${found.article}`,
    alternates: { canonical: `/${locale}/p/${found.slug}`, languages: { uz: `/uz/p/${found.slug}`, ru: `/ru/p/${found.slug}` } },
    openGraph: { title: found.name, type: "website", images: image ? [`${origin}${image}`] : undefined },
  };
}

export default async function ProductPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const product = await load(locale, slug);
  const related = await getRelated(product.id, locale).catch(() => []);
  const m = getMessages(locale);
  const origin = process.env.PUBLIC_URL ?? "http://localhost:3000";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.article || undefined,
    description: product.description || undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    image: product.images.map((i) => `${origin}${i.large}`),
    offers: {
      "@type": "Offer",
      url: `${origin}/${locale}/p/${product.slug}`,
      priceCurrency: "UZS",
      price: product.price,
      availability: product.stockStatus === "out" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    },
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: product.categoryPath.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${origin}/${locale}/c/${c.slug}` })),
  };
  // JSON-LD is data inside a script tag: escape "<" so a product name can never close the tag.
  const ld = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");

  return (
    <article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(jsonLd) }} />
      {product.categoryPath.length > 0 ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(breadcrumbLd) }} /> : null}
      <nav aria-label={m.listing.breadcrumbs} className="mb-4 text-small text-ink-2">
        <ol className="flex flex-wrap gap-1.5">
          <li><Link href={`/${locale}/catalog`} className="hover:underline">{m.nav.catalog}</Link></li>
          {product.categoryPath.map((c) => (
            <li key={c.slug} className="flex gap-1.5"><span aria-hidden>/</span><Link href={`/${locale}/c/${c.slug}`} className="hover:underline">{c.name}</Link></li>
          ))}
        </ol>
      </nav>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,30rem)_1fr]">
        <ProductGallery images={product.images} name={product.name} />
        <div>
          {product.brand ? <p className="text-small font-medium text-ink-2">{product.brand}</p> : null}
          <h1 className="text-title font-bold text-balance">{product.name}</h1>
          <p className="tnum mt-1 text-small text-ink-2">{m.product.article}: <span className="font-mono">{product.article}</span></p>
          <div className="mt-5 rounded-card border border-line bg-card p-5">
            <ProductBuy product={product} />
          </div>
          {product.description ? (
            <section className="mt-6" aria-label={m.productPage.description}>
              <h2 className="text-lead font-semibold">{m.productPage.description}</h2>
              {/* Plain text from MoySklad: rendered as paragraphs, never as HTML. */}
              {product.description.split(/\n{2,}|\n/).filter(Boolean).map((para, i) => (
                <p key={i} className="mt-2 max-w-prose text-body text-ink-2">{para}</p>
              ))}
            </section>
          ) : null}
          <section className="mt-6" aria-label={m.productPage.details}>
            <h2 className="text-lead font-semibold">{m.productPage.details}</h2>
            <dl className="mt-2 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-body">
              {product.article ? (<><dt className="text-ink-2">{m.product.article}</dt><dd className="tnum font-mono">{product.article}</dd></>) : null}
              {product.unit ? (<><dt className="text-ink-2">{m.productPage.unit}</dt><dd>{product.unit}</dd></>) : null}
              {product.barcodes[0] ? (<><dt className="text-ink-2">{m.productPage.barcode}</dt><dd className="tnum font-mono">{product.barcodes[0]}</dd></>) : null}
            </dl>
          </section>
        </div>
      </div>
      {related.length > 0 ? (
        <section className="mt-12" aria-label={m.productPage.related}>
          <h2 className="mb-3 text-lead font-bold">{m.productPage.related}</h2>
          <ProductGrid products={related.slice(0, 8)} />
        </section>
      ) : null}
    </article>
  );
}
