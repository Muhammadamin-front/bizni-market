import type { ButtonHTMLAttributes } from "react";
import { cn } from "../cn";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** A filter/category chip. Selection is ink, not the action colour: choosing a category is not an action. */
export function Chip({ selected = false, className, children, type = "button", ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-10 shrink-0 items-center rounded-control border px-4 text-small font-medium whitespace-nowrap pointer-coarse:h-11",
        "transition-colors duration-150 ease-out active:scale-[0.98]",
        selected ? "border-ink bg-ink text-on-ink" : "border-line bg-card text-ink hover:border-line-strong",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
