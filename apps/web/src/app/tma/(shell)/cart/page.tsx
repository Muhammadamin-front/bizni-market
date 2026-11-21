"use client";

import { CartView } from "@/components/site/CartView";
import { useI18n } from "@/lib/i18n";

export default function TmaCart() {
  const { messages: m, href } = useI18n();
  return (
    <div>
      <h1 className="mb-3 text-lead font-bold">{m.cart.title}</h1>
      <CartView checkoutHref={href("/checkout")} />
    </div>
  );
}
