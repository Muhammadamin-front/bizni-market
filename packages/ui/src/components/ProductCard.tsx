"use client";

import type { Locale, Messages, ProductCardData } from "@shop/shared";
import { Heart, Package } from "lucide-react";
import type { ElementType, ReactNode } from "react";
import { cn } from "../cn";
import { AddToCart } from "./AddToCart";
import { IconButton } from "./IconButton";
import { Price } from "./Price";
import { StockBadge } from "./StockBadge";

export interface ProductViewProps {
  product: ProductCardData;
  locale: Locale;
  messages: Messages;
  /** Quantity of this product already in the cart. */
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  favorite?: boolean;
  onFavoriteChange?: (favorite: boolean) => void;
  href?: string;
  /** Anchor component for the product link (e.g. next/link). Defaults to a plain <a>. */
  link?: ElementType;
  /** Replaces the product photo (used for demo art and future placeholders). */
  media?: ReactNode;
  className?: string;
}

export function stockLabel(product: ProductCardData, messages: Messages): string {
  if (product.stockStatus === "out") return messages.product.outOfStock;
  if (product.stockStatus === "low") return messages.product.lowStock(product.freeStock);
  return messages.product.inStock;
}

export function ProductImage({ product, media, size }: { product: ProductCardData; media?: ReactNode; size: number }) {
  if (media) return <>{media}</>;
  if (product.imageUrl) {
    return (
      // Every product photo is stored as a 1:1 square on white with its own margin (see core/media.ts), pre-sized to our storage.
      // object-contain is the safety net for anything older: it can never stretch or crop.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={product.imageUrl} alt="" width={size} height={size} loading="lazy" decoding="async" className="size-full object-contain" />
    );
  }
  return <Package aria-hidden className="size-1/3 text-line-strong" strokeWidth={1.25} />;
}

/**
 * Frame for a product photo. Photos are white squares, so the frame is white and unpadded (no grey border around a white photo,
 * in the light theme and in the Mini App's dark theme alike); the placeholder and demo art keep the soft grey well.
 */
export function photoFrame(product: ProductCardData, media: ReactNode | undefined, padding: string): string {
  return !media && product.imageUrl ? "bg-white" : cn("bg-sunken", padding);
}

/** Grid card: image, brand, name, article, price, stock, add. The whole card links to the product; add/favourite sit above the link. */
export function ProductCard({
  product,
  locale,
  messages,
  quantity,
  onQuantityChange,
  favorite = false,
  onFavoriteChange,
  href = "#",
  link,
  media,
  className,
}: ProductViewProps) {
  const A: ElementType = link ?? "a";
  const out = product.stockStatus === "out";
  const m = messages.product;
  return (
    <article className={cn("relative flex h-full flex-col overflow-hidden rounded-card border border-line bg-card", className)}>
      <div className={cn("relative flex aspect-square items-center justify-center", photoFrame(product, media, "p-3"))}>
        <div className={cn("flex size-full items-center justify-center", out && "opacity-50")}>
          <ProductImage product={product} media={media} size={400} />
        </div>
        {onFavoriteChange ? (
          <IconButton
            aria-label={favorite ? m.unfavorite : m.favorite}
            pressed={favorite}
            onClick={() => onFavoriteChange(!favorite)}
            className="absolute top-1 right-1 z-10"
            // The heart sits on the photo, which is white in every theme: it gets its own light chip and a fixed dark ink,
            // so it stays visible in the Mini App's dark theme too.
            icon={
              <span className="flex size-8 items-center justify-center rounded-full bg-white/90 shadow-sm">
                <Heart aria-hidden className={cn("size-[18px]", favorite ? "fill-current text-link" : "text-[#1d1d1f]")} />
              </span>
            }
          />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.brand ? <p className="text-caption font-medium text-ink-2">{product.brand}</p> : null}
        <h3 className="line-clamp-2 min-h-[2.7em] text-[0.9375rem] leading-snug font-medium text-ink">
          <A href={href} className="after:absolute after:inset-0 hover:underline focus-visible:outline-offset-[-2px]">
            {product.name}
          </A>
        </h3>
        <p className="text-caption text-ink-2">
          <span className="tnum font-mono">{product.article}</span>
          {product.packSize ? <span> · {m.perPack(product.packSize)}</span> : null}
        </p>
        <div className="mt-auto flex flex-col gap-1 pt-2">
          <Price amount={product.price} oldAmount={product.oldPrice} locale={locale} muted={out} />
          <StockBadge status={product.stockStatus} label={stockLabel(product, messages)} />
        </div>
        <div className="relative z-10 pt-2">
          <AddToCart
            quantity={quantity}
            onChange={onQuantityChange}
            max={Math.max(product.freeStock, 0)}
            step={product.qtyStep}
            disabled={out}
            labels={{ add: m.add, quantity: m.quantity, increase: m.increase, decrease: m.decrease }}
          />
        </div>
      </div>
    </article>
  );
}
