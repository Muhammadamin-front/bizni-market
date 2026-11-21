import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one action colour; secondary = outlined; ghost = text only. */
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
  loading?: boolean;
  fullWidth?: boolean;
}

const base =
  "inline-flex select-none items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap " +
  "transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] " +
  "disabled:cursor-not-allowed disabled:active:scale-100";

const variants = {
  primary: "bg-action text-white hover:bg-action-press disabled:bg-off disabled:text-off-ink",
  secondary:
    "border border-line-strong bg-card text-ink hover:bg-sunken disabled:border-line disabled:bg-transparent disabled:text-off-ink",
  ghost: "text-ink hover:bg-sunken disabled:text-off-ink disabled:hover:bg-transparent",
} as const;

const sizes = {
  md: "h-11 px-4 text-[0.9375rem]",
  sm: "h-9 px-3 text-small pointer-coarse:h-11",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], fullWidth && "w-full", className)}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
      {children}
    </button>
  );
}
