import { getMessages, isLocale } from "@shop/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CartView } from "@/components/site/CartView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div>
      <h1 className="mb-5 text-title font-bold">{getMessages(locale).cart.title}</h1>
      <CartView checkoutHref={`/${locale}/checkout`} />
    </div>
  );
}
