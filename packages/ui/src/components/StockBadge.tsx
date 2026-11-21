import type { StockStatus } from "@shop/shared";
import { cn } from "../cn";

export interface StockBadgeProps {
  status: StockStatus;
  /** Already-localised text, e.g. "Omborda bor" or "Faqat 3 dona qoldi". */
  label: string;
  className?: string;
}

const tone: Record<StockStatus, { dot: string; text: string }> = {
  in: { dot: "bg-ok", text: "text-ink-2" },
  low: { dot: "bg-warn", text: "text-warn" },
  out: { dot: "bg-out", text: "text-out" },
};

/** The dot is decoration: the text always carries the meaning, so colour is never the only signal. */
export function StockBadge({ status, label, className }: StockBadgeProps) {
  const t = tone[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-small", t.text, className)}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", t.dot)} />
      {label}
    </span>
  );
}
