"use client";

import { use } from "react";
import { OrderStatusView } from "@/components/site/OrderStatusView";
import { useI18n } from "@/lib/i18n";

export default function TmaOrder({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  const { href } = useI18n();
  return <OrderStatusView publicId={publicId} backHref={href("/catalog")} />;
}
