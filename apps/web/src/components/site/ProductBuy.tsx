"use client";

import type { ProductCardData } from "@shop/shared";
import { AddToCart, Price, StockBadge, stockLabel } from "@shop/ui";
import Link from "next/link";
import { useCart } from "@/lib/cart";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";

export function ProductBuy({ product }: { product: ProductCardData }) {
  const { locale, messages, href } = useI18n();
  const { quantityOf, setQuantity } = useCart();
  const toast = useToast();
  const quantity = quantityOf(product.id);
  const m = messages.product;
  return (
    <div className="flex flex-col gap-3">
      <Price amount={product.price} oldAmount={product.oldPrice} locale={locale} size="lg" muted={product.stockStatus === "out"} />
      <StockBadge status={product.stockStatus} label={stockLabel(product, messages)} />
      {product.packSize ? <p className="text-small text-ink-2">{m.perPack(product.packSize)}</p> : null}
      <div className="max-w-xs">
        <AddToCart
          quantity={quantity}
          max={Math.max(product.freeStock, 0)}
          step={product.qtyStep}
          disabled={product.stockStatus === "out"}
          labels={{ add: m.add, quantity: m.quantity, increase: m.increase, decrease: m.decrease }}
          onChange={(q) => {
            if (quantity === 0 && q > 0) toast.show(messages.states.addedToast);
            setQuantity(product.id, q);
          }}
        />
      </div>
      {quantity > 0 ? (
        <Link href={href("/cart")} className="text-small font-semibold text-action underline underline-offset-4">
          {messages.nav.cart} →
        </Link>
      ) : null}
    </div>
  );
}
