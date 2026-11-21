"use client";

import type { Locale } from "@shop/shared";
import { cn } from "../cn";

export interface LanguageSwitchProps {
  value: Locale;
  onChange: (locale: Locale) => void;
  /** Accessible name of the group, e.g. "Til" / "Язык". */
  label: string;
  options: ReadonlyArray<{ locale: Locale; label: string }>;
}

export function LanguageSwitch({ value, onChange, label, options }: LanguageSwitchProps) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-control border border-line bg-card p-0.5">
      {options.map((option) => {
        const selected = option.locale === value;
        return (
          <button
            key={option.locale}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.locale)}
            className={cn(
              "h-9 min-w-11 rounded-[6px] px-2.5 text-small font-semibold transition-colors duration-150 ease-out",
              selected ? "bg-ink text-white" : "text-ink-2 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
