"use client";

import type { ProductCardData } from "@shop/shared";
import { EmptyState, Skeleton } from "@shop/ui";
import { Heart } from "lucide-react";
import { ProductGrid } from "@/components/ProductTile";
import { useI18n } from "@/lib/i18n";
import { useTma } from "@/lib/tma";
import { useFetch } from "@/lib/use-fetch";

export default function TmaFavorites() {
  const { messages: m } = useI18n();
  const { token } = useTma();
  const { data, loading } = useFetch<ProductCardData[]>(token ? "/api/v1/favorites" : null, token ? { Authorization: `Bearer ${token}` } : undefined);
  if (loading && !data) return <Skeleton className="h-40" />;
  if (!data?.length) return <EmptyState icon={<Heart className="size-7" strokeWidth={1.5} />} title={m.nav.favorites} body={m.product.favorite} />;
  return (
    <div>
      <h1 className="mb-3 text-lead font-bold">{m.nav.favorites}</h1>
      <ProductGrid products={data} withFavorite />
    </div>
  );
}
