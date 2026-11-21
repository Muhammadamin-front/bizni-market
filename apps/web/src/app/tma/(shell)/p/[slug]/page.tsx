"use client";

import type { ProductDetail } from "@shop/shared";
import { Skeleton } from "@shop/ui";
import { use } from "react";
import { ProductGrid } from "@/components/ProductTile";
import { ProductBuy } from "@/components/site/ProductBuy";
import { ProductGallery } from "@/components/site/ProductGallery";
import { useI18n } from "@/lib/i18n";
import { useFetch } from "@/lib/use-fetch";
import type { ProductCardData } from "@shop/shared";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function TmaProduct({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { locale, messages: m, href } = useI18n();
  const router = useRouter();
  const { data, loading, error } = useFetch<ProductDetail | { redirectTo: string }>(`/api/v1/products/${encodeURIComponent(slug)}?locale=${locale}`);
  const product = data && !("redirectTo" in data) ? data : null;
  const related = useFetch<ProductCardData[]>(product ? `/api/v1/products/${product.id}/related` : null);

  useEffect(() => {
    if (data && "redirectTo" in data) router.replace(href(`/p/${data.redirectTo}`));
  }, [data, router, href]);

  if (loading && !data) return <Skeleton className="aspect-square w-full" />;
  if (error || !product) return <p className="p-6 text-center text-ink-2">{m.errors.notFoundBody}</p>;
  return (
    <article>
      <ProductGallery images={product.images} name={product.name} />
      {product.brand ? <p className="mt-3 text-small font-medium text-ink-2">{product.brand}</p> : null}
      <h1 className="text-lead font-bold text-balance">{product.name}</h1>
      <p className="tnum text-small text-ink-2">{m.product.article}: <span className="font-mono">{product.article}</span></p>
      <div className="mt-4 rounded-card border border-line bg-card p-4"><ProductBuy product={product} /></div>
      {product.description ? (
        <section className="mt-5"><h2 className="font-semibold">{m.productPage.description}</h2>{product.description.split("\n").filter(Boolean).map((p, i) => <p key={i} className="mt-1 text-small text-ink-2">{p}</p>)}</section>
      ) : null}
      {related.data && related.data.length > 0 ? (<section className="mt-6"><h2 className="mb-2 font-bold">{m.productPage.related}</h2><ProductGrid products={related.data.slice(0, 6)} withFavorite /></section>) : null}
    </article>
  );
}
