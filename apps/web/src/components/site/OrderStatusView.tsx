"use client";

import { formatPrice, LOCAL_ORDER_STATUS_INFO, type OrderView } from "@shop/shared";
import { Button, Skeleton } from "@shop/ui";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

export function OrderStatusView({ publicId, backHref, celebrate = true }: { publicId: string; backHref: string; celebrate?: boolean }) {
  const { locale, messages } = useI18n();
  const m = messages.order;
  const [order, setOrder] = useState<OrderView | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/orders/${publicId}`, { cache: "no-store" });
      if (res.status === 404) return setMissing(true);
      if (res.ok) setOrder((await res.json()) as OrderView);
    } catch {
      /* keep the last known state; the next poll retries */
    }
  }, [publicId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when the inputs of this data-loading effect change is the intent
    void load();
    // Staff change the status (in MoySklad or in our admin); poll gently so the customer sees it.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 20_000);
    return () => clearInterval(t);
  }, [load]);

  if (missing) return <p className="py-10 text-center text-ink-2">{messages.errors.notFoundBody}</p>;
  if (!order) return <Skeleton className="h-64 w-full" />;
  const status = order.statusCode ? LOCAL_ORDER_STATUS_INFO[order.statusCode][locale] : (order.status ?? (order.syncStatus === "pending_sync" ? m.sending : m.received));

  return (
    <div className="mx-auto max-w-2xl">
      {celebrate ? (
        <div className="flex items-center gap-3">
          <CheckCircle2 aria-hidden className="size-9 shrink-0 text-ok" />
          <h1 className="text-title font-bold text-balance">{m.thanks}</h1>
        </div>
      ) : null}
      <div className="mt-5 rounded-card border border-line bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-lead font-semibold">{m.number(order.number)}</p>
          <p className="text-small text-ink-2">{new Date(order.createdAt).toLocaleString(locale === "ru" ? "ru-RU" : "uz-UZ")}</p>
        </div>
        <p className="mt-3 flex items-center gap-2" aria-live="polite">
          <span className="text-small text-ink-2">{m.status}:</span>
          <span className="rounded-full bg-sunken px-3 py-1 text-small font-semibold">{status}</span>
        </p>
        <ul className="mt-4 divide-y divide-line text-body">
          {order.items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3 py-2">
              <span className="min-w-0">{i.name} <span className="tnum text-ink-2">× {String(i.quantity).replace(".", ",")}</span></span>
              <span className="tnum shrink-0">{formatPrice(i.lineTotal, locale)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex justify-between border-t border-line pt-3 text-lead font-bold"><span>{m.total}</span><span className="tnum">{formatPrice(order.total, locale)}</span></p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
          <dt className="text-ink-2">{m.deliveryTo}</dt>
          <dd>{order.deliveryMethod === "pickup" ? m.pickup : order.address}</dd>
          <dt className="text-ink-2">{m.contact}</dt>
          <dd>{order.contactName}, {order.contactPhone}</dd>
        </dl>
      </div>
      {celebrate ? <p className="mt-4 text-small text-ink-2">{m.keepLink}</p> : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href={backHref} className="inline-flex h-11 items-center rounded-control bg-action px-5 font-semibold text-white hover:bg-action-press">{m.backToShop}</Link>
        <Button variant="secondary" onClick={() => void load()}>{m.refresh}</Button>
      </div>
    </div>
  );
}
