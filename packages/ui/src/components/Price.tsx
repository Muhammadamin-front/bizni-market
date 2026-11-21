import { currencyWord, discountPercent, formatAmount, type Locale } from "@shop/shared";
import { cn } from "../cn";

export interface PriceProps {
  /** Integer UZS. */
  amount: number;
  /** Integer UZS, shown struck through only when higher than `amount`. */
  oldAmount?: number | null;
  locale: Locale;
  size?: "md" | "lg";
  muted?: boolean;
  className?: string;
}

export function Price({ amount, oldAmount, locale, size = "md", muted = false, className }: PriceProps) {
  const percent = discountPercent(amount, oldAmount);
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2 gap-y-0", className)}>
      <span className={cn("tnum font-bold", size === "lg" ? "text-title" : "text-lead", muted ? "text-ink-2" : "text-ink")}>
        {formatAmount(amount)}
        <span className={cn("ml-1 font-medium text-ink-2", size === "lg" ? "text-body" : "text-small")}>{currencyWord(locale)}</span>
      </span>
      {percent > 0 && oldAmount ? (
        <span className="tnum inline-flex items-baseline gap-1.5 text-small text-ink-2">
          <s>{formatAmount(oldAmount)}</s>
          <span className="font-semibold text-promo">−{percent}%</span>
        </span>
      ) : null}
    </span>
  );
}
