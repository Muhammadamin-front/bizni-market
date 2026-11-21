"use client";

import type { ReactNode } from "react";
import { cn } from "../cn";

export interface TabItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** Count bubble, e.g. items in the cart. Hidden at 0. */
  badge?: number;
}

export interface BottomTabBarProps {
  items: ReadonlyArray<TabItem>;
  activeId: string;
  onSelect: (id: string) => void;
  /** Accessible name of the navigation, e.g. "Asosiy menyu". */
  label: string;
  className?: string;
}

/** Thumb-reach navigation. The active tab takes the action colour; everything else stays quiet. */
export function BottomTabBar({ items, activeId, onSelect, label, className }: BottomTabBarProps) {
  return (
    <nav aria-label={label} className={cn("border-t border-line bg-card pb-[env(safe-area-inset-bottom)]", className)}>
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-semibold transition-colors duration-150",
                  active ? "text-action" : "text-ink-2 hover:text-ink",
                )}
              >
                <span className="relative">
                  {item.icon}
                  {item.badge && item.badge > 0 ? (
                    <span className="tnum absolute -top-1.5 -right-2.5 inline-flex min-w-4.5 items-center justify-center rounded-full bg-action px-1 text-[0.6875rem] leading-[1.125rem] font-bold text-white">
                      <span className="sr-only">{item.label}: </span>
                      {item.badge}
                    </span>
                  ) : null}
                </span>
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
