"use client";

import { formatPrice, LOCAL_ORDER_STATUS_INFO, type OrderView } from "@shop/shared";
import { EmptyState, Skeleton } from "@shop/ui";
import { ReceiptText } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { useTma } from "@/lib/tma";
import { useFetch } from "@/lib/use-fetch";

export default function TmaOrders() {
  const { locale, messages: m, href } = useI18n();
  const { token } = useTma();
  const { data, loading } = useFetch<OrderView[]>(token ? "/api/v1/orders" : null, token ? { Authorization: `Bearer ${token}` } : undefined);
  if (loading && !data) return <Skeleton className="h-40" />;
  if (!data?.length) return <EmptyState icon={<ReceiptText className="size-7" strokeWidth={1.5} />} title={m.order.noOrders} body="" />;
  return (
    <div>
      <h1 className="mb-3 text-lead font-bold">{m.order.myOrders}</h1>
      <ul className="flex flex-col gap-2">
        {data.map((o) => (
          <li key={o.id}>
            <Link href={href(`/order/${o.publicId}`)} className="flex items-center justify-between gap-3 rounded-card border border-line bg-card p-3">
              <span><span className="block font-semibold">{m.order.number(o.number)}</span><span className="text-caption text-ink-2">{new Date(o.createdAt).toLocaleDateString(locale === "ru" ? "ru-RU" : "uz-UZ")} · {o.statusCode ? LOCAL_ORDER_STATUS_INFO[o.statusCode][locale] : (o.status ?? m.order.received)}</span></span>
              <span className="tnum font-bold">{formatPrice(o.total, locale)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
