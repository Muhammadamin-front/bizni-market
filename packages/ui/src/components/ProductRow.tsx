"use client";

import type { ElementType } from "react";
import { cn } from "../cn";
import { AddToCart } from "./AddToCart";
import { Price } from "./Price";
import { photoFrame, ProductImage, stockLabel, type ProductViewProps } from "./ProductCard";
import { StockBadge } from "./StockBadge";

/**
 * Dense list row for the table view on desktop (same data and same add control as the card).
 * On phones the add control drops under the details so the row never squeezes.
 */
export function ProductRow({ product, locale, messages, quantity, onQuantityChange, href = "#", link, media, className }: ProductViewProps) {
  const A: ElementType = link ?? "a";
  const out = product.stockStatus === "out";
  const m = messages.product;
  return (
    <article
      className={cn(
        "relative grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-line bg-card px-3 py-2.5",
        "md:grid-cols-[3.5rem_minmax(0,1fr)_7rem_9.5rem_9rem_10.5rem]",
        className,
      )}
    >
      <div className={cn("flex size-14 items-center justify-center overflow-hidden rounded-control", photoFrame(product, media, "p-1"), out && "opacity-50")}>
        <ProductImage product={product} media={media} size={112} />
      </div>
      <div className="min-w-0">
        {product.brand ? <p className="text-caption font-medium text-ink-2">{product.brand}</p> : null}
        <h3 className="text-[0.9375rem] leading-snug font-medium text-ink md:truncate">
          <A href={href} className="after:absolute after:inset-0 hover:underline focus-visible:outline-offset-[-2px]">
            {product.name}
          </A>
        </h3>
        <p className="text-caption text-ink-2">
          <span className="tnum font-mono">{product.article}</span>
        </p>
      </div>
      <p className="tnum hidden text-small text-ink-2 md:block">{product.packSize ? m.perPack(product.packSize) : ""}</p>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 md:col-span-1 md:block">
        <StockBadge status={product.stockStatus} label={stockLabel(product, messages)} />
      </div>
      <div className="col-span-2 md:col-span-1">
        <Price amount={product.price} oldAmount={product.oldPrice} locale={locale} muted={out} />
      </div>
      <div className="relative z-10 col-span-2 md:col-span-1">
        <AddToCart
          quantity={quantity}
          onChange={onQuantityChange}
          max={Math.max(product.freeStock, 0)}
          step={product.qtyStep}
          disabled={out}
          labels={{ add: m.add, quantity: m.quantity, increase: m.increase, decrease: m.decrease }}
        />
      </div>
    </article>
  );
}
