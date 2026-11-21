import { isLocale } from "@shop/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderStatusView } from "@/components/site/OrderStatusView";

export const dynamic = "force-dynamic";
// The link is a secret: never indexed, never sent to third parties in a Referer.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function OrderPage({ params }: { params: Promise<{ locale: string; publicId: string }> }) {
  const { locale, publicId } = await params;
  if (!isLocale(locale)) notFound();
  return <OrderStatusView publicId={publicId} backHref={`/${locale}/catalog`} />;
}
