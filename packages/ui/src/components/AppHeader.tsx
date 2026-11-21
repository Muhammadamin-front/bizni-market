import type { ReactNode } from "react";

export interface AppHeaderProps {
  /** Wordmark or logo. */
  brand: ReactNode;
  /** Right side: language switch, cart on desktop. */
  trailing?: ReactNode;
  /** The search field. Sits under the wordmark on phones and between wordmark and actions on desktop. */
  children?: ReactNode;
}

export function AppHeader({ brand, trailing, children }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ground">
      <div className="mx-auto grid max-w-[1280px] grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 px-4 py-3 lg:grid-cols-[auto_minmax(0,40rem)_1fr] lg:px-6">
        <div className="text-lead font-bold tracking-tight text-ink">{brand}</div>
        <div className="col-span-2 row-start-2 lg:col-span-1 lg:col-start-2 lg:row-start-1">{children}</div>
        <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 lg:col-start-3">{trailing}</div>
      </div>
    </header>
  );
}
