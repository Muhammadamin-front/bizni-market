import { SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../cn";

export interface EmptyStateProps {
  title: string;
  body: string;
  /** Usually a Button that fixes the situation (clear filters, back to catalog). */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, body, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <div aria-hidden className="flex size-14 items-center justify-center rounded-card bg-sunken text-ink-2">
        {icon ?? <SearchX className="size-7" strokeWidth={1.5} />}
      </div>
      <h2 className="text-lead font-semibold text-balance">{title}</h2>
      <p className="max-w-sm text-body text-ink-2 text-pretty">{body}</p>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
