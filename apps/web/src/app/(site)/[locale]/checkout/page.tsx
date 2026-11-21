import { getMessages, isLocale } from "@shop/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutForm } from "@/components/site/CheckoutForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div>
      <h1 className="mb-5 text-title font-bold">{getMessages(locale).checkout.title}</h1>
      <CheckoutForm orderPrefix={`/${locale}/order`} cartHref={`/${locale}/cart`} />
    </div>
  );
}
