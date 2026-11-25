"use client";

import { formatPrice, type ProductCardData } from "@shop/shared";
import { Button, EmptyState, Price, QuantityStepper, Skeleton } from "@shop/ui";
import { ShoppingBasket, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { type CartLine, useCart, useCartProducts } from "@/lib/cart";
import { useI18n } from "@/lib/i18n";
import { useMainButton, useTma } from "@/lib/tma";

export function lineTotal(p: ProductCardData, qty: number) {
  return Math.round(p.price * qty);
}

/** What the cart can actually sell right now: a line is unavailable when the product vanished or is out of stock. */
export function resolveLines(lines: CartLine[], products: Map<string, ProductCardData>, loaded: boolean) {
  return lines.map((l) => {
    const p = products.get(l.productId);
    const unavailable = loaded && (!p || p.stockStatus === "out" || p.freeStock <= 0);
    const over = !!p && !unavailable && l.quantity > p.freeStock;
    return { line: l, product: p, unavailable, over };
  });
}

export function CartView({ checkoutHref }: { checkoutHref: string }) {
  const { locale, messages, href } = useI18n();
  const { lines, setQuantity } = useCart();
  const { products, loading, error, reload } = useCartProducts(lines, locale);
  const m = messages.cart;
  const loaded = !loading && !error;
  const rows = resolveLines(lines, products, loaded);

  // Quantities above what is in stock are pulled down to the stock: the customer sees the truth before checkout, not an error after it.
  useEffect(() => {
    for (const r of rows) if (r.over && r.product) setQuantity(r.product.id, Math.floor(r.product.freeStock / r.product.qtyStep) * r.product.qtyStep);
  });

  const sellable = rows.filter((r) => r.product && !r.unavailable);
  const total = sellable.reduce((s, r) => s + lineTotal(r.product!, r.line.quantity), 0);
  const blocked = rows.some((r) => r.unavailable) || loading || error;
  const tma = useTma();
  const router = useRouter();
  // Inside Telegram the native MainButton is the primary action; elsewhere the page shows its own.
  const native = useMainButton(tma.inTelegram && lines.length > 0 ? { text: `${m.proceed} · ${formatPrice(total, locale)}`, onClick: () => router.push(checkoutHref), disabled: !!blocked } : null);

  if (lines.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingBasket className="size-7" strokeWidth={1.5} />}
        title={m.empty}
        body={m.emptyBody}
        action={<Link href={href("/catalog")} className="inline-flex h-11 items-center rounded-control bg-action px-5 font-semibold text-white hover:bg-action-press">{m.goCatalog}</Link>}
      />
    );
  }


  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <ul className="divide-y divide-line rounded-card border border-line bg-card">
        {rows.map(({ line, product, unavailable, over }) => (
          <li key={line.productId} className="flex gap-3 p-3 sm:gap-4 sm:p-4">
            <div className={`flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-control ${product?.imageUrl ? "border border-line bg-white" : "bg-sunken p-1"}`}>
              {product?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrl} alt="" width={80} height={80} className="size-full object-contain" loading="lazy" />
              ) : loading ? (
                <Skeleton className="size-full" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              {product ? (
                <Link href={href(`/p/${product.slug}`)} className="line-clamp-2 font-medium hover:underline">{product.name}</Link>
              ) : (
                <p className="font-medium text-ink-2">{loading ? m.loading : m.unavailable}</p>
              )}
              {product ? <Price amount={product.price} oldAmount={product.oldPrice} locale={locale} /> : null}
              {unavailable ? <p className="mt-1 text-small font-medium text-out">{m.unavailable}</p> : null}
              {over && product ? <p className="mt-1 text-small text-warn">{m.onlyLeft(product.freeStock)}</p> : null}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                {product && !unavailable ? (
                  <QuantityStepper value={line.quantity} min={0} max={Math.max(product.freeStock, 0)} step={product.qtyStep} onChange={(q) => setQuantity(line.productId, q)} labels={{ quantity: messages.product.quantity, increase: messages.product.increase, decrease: messages.product.decrease }} className="w-36" />
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  {product && !unavailable ? <p className="tnum font-bold">{formatPrice(lineTotal(product, line.quantity), locale)}</p> : null}
                  <button type="button" onClick={() => setQuantity(line.productId, 0)} aria-label={`${m.remove}: ${product?.name ?? ""}`} className="inline-flex size-11 items-center justify-center rounded-control text-ink-2 hover:bg-sunken hover:text-ink">
                    <Trash2 aria-hidden className="size-5" />
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <aside className="h-fit rounded-card border border-line bg-card p-5 lg:sticky lg:top-28">
        <dl className="space-y-2 text-body">
          <div className="flex justify-between"><dt className="text-ink-2">{m.items(sellable.length)}</dt><dd className="tnum">{formatPrice(total, locale)}</dd></div>
          <div className="flex justify-between border-t border-line pt-3 text-lead font-bold"><dt>{m.total}</dt><dd className="tnum">{formatPrice(total, locale)}</dd></div>
        </dl>
        {error ? (
          <p className="mt-3 text-small text-promo">{messages.errors.body} <button type="button" onClick={reload} className="font-semibold underline">{messages.errors.retry}</button></p>
        ) : null}
        {blocked && !error && rows.some((r) => r.unavailable) ? <p className="mt-3 text-small text-warn">{m.unavailable}: {m.remove.toLowerCase()}</p> : null}
        <div className="mt-4">
          {native ? null : blocked ? (
            <Button fullWidth disabled>{m.proceed}</Button>
          ) : (
            <Link href={checkoutHref} className="inline-flex h-11 w-full items-center justify-center rounded-control bg-action font-semibold text-white hover:bg-action-press">{m.proceed}</Link>
          )}
        </div>
        <button type="button" onClick={() => lines.forEach((l) => setQuantity(l.productId, 0))} className="mt-3 w-full text-center text-small text-ink-2 hover:text-ink hover:underline">{m.clear}</button>
      </aside>
    </div>
  );
}
