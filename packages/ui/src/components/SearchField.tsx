"use client";

import { Search, X } from "lucide-react";
import type { FormEvent } from "react";
import { cn } from "../cn";

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder: string;
  /** Accessible name of the field. */
  label: string;
  clearLabel: string;
  className?: string;
}

export function SearchField({ value, onChange, onSubmit, placeholder, label, clearLabel, className }: SearchFieldProps) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit?.(value);
  }

  return (
    <form role="search" onSubmit={handleSubmit} className={cn("relative", className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-2" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="search"
        autoComplete="off"
        className="h-11 w-full rounded-control border border-line bg-card pr-11 pl-11 text-body text-ink transition-colors duration-150 hover:border-line-strong focus:border-action focus:outline-none focus-visible:outline-none"
      />
      {value ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onChange("")}
          className="absolute top-1/2 right-0.5 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-control text-ink-2 hover:text-ink"
        >
          <X aria-hidden className="size-5" />
        </button>
      ) : null}
    </form>
  );
}
