import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../cn";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  /** Required: an icon alone has no name. */
  "aria-label": string;
  icon: ReactNode;
  /** Pressed/selected state, e.g. a favourite that is on. */
  pressed?: boolean;
}

export function IconButton({ icon, pressed, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-control text-ink transition-[background-color,transform] duration-150 ease-out",
        "hover:bg-sunken active:scale-95 disabled:cursor-not-allowed disabled:text-off-ink disabled:hover:bg-transparent",
        pressed && "text-action",
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
