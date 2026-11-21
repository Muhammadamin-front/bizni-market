"use client";

import { cn } from "../cn";

export interface BrandStripProps {
  brands: ReadonlyArray<{ id: string; name: string }>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Accessible name, e.g. "Brendlar". */
  label: string;
}

/** Brands as a scrollable text strip (brands are a primary way into the catalog). Tapping the selected one clears it. */
export function BrandStrip({ brands, selectedId, onSelect, label }: BrandStripProps) {
  return (
    <nav aria-label={label}>
      <ul className="-mx-4 flex snap-x gap-1 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {brands.map((brand) => {
          const selected = brand.id === selectedId;
          return (
            <li key={brand.id} className="snap-start">
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(selected ? null : brand.id)}
                className={cn(
                  "relative inline-flex h-10 items-center px-3 text-small font-semibold whitespace-nowrap transition-colors duration-150 pointer-coarse:h-11",
                  selected ? "text-ink" : "text-ink-2 hover:text-ink",
                )}
              >
                {brand.name}
                <span aria-hidden className={cn("absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-ink transition-opacity duration-150", selected ? "opacity-100" : "opacity-0")} />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
