"use client";

import { CheckoutForm } from "@/components/site/CheckoutForm";
import { useI18n } from "@/lib/i18n";
import { useTma } from "@/lib/tma";

export default function TmaCheckout() {
  const { messages: m, href } = useI18n();
  const { token, me } = useTma();
  return (
    <div>
      <h1 className="mb-3 text-lead font-bold">{m.checkout.title}</h1>
      <CheckoutForm token={token} orderPrefix={href("/order")} cartHref={href("/cart")} prefill={{ name: me?.name, phone: me?.phone }} />
    </div>
  );
}
