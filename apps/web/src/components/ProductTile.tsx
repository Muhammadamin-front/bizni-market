"use client";

import type { ProductCardData } from "@shop/shared";
import { ProductCard, ProductRow } from "@shop/ui";
import Link from "next/link";
import { useCart } from "@/lib/cart";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { useFavorites } from "@/lib/favorites";
import { haptic } from "@/lib/tma";

/** One product, wired to the cart. Used by the site, the Mini App and the cart-adjacent rails. */
export function ProductTile({ product, variant = "card", withFavorite = false }: { product: ProductCardData; variant?: "card" | "row"; withFavorite?: boolean }) {
  const { locale, messages, href } = useI18n();
  const { quantityOf, setQuantity } = useCart();
  const toast = useToast();
  const fav = useFavorites();
  const quantity = quantityOf(product.id);

  const onQuantityChange = (next: number) => {
    if (quantity === 0 && next > 0) toast.show(messages.states.addedToast);
    haptic("light");
    setQuantity(product.id, next);
  };
  const shared = { product, locale, messages, quantity, onQuantityChange, href: href(`/p/${product.slug}`), link: Link };
  if (variant === "row") return <ProductRow {...shared} />;
  return <ProductCard {...shared} favorite={withFavorite ? fav.has(product.id) : undefined} onFavoriteChange={withFavorite && fav.enabled ? (on) => fav.set(product.id, on) : undefined} />;
}

export function ProductGrid({ products, view = "grid", withFavorite = false }: { products: ProductCardData[]; view?: "grid" | "list"; withFavorite?: boolean }) {
  if (view === "list") {
    return (
      <div className="overflow-hidden rounded-card border border-line">
        {products.map((p) => (
          <ProductTile key={p.id} product={p} variant="row" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductTile key={p.id} product={p} withFavorite={withFavorite} />
      ))}
    </div>
  );
}
