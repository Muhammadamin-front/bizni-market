"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";

export function SortSelect({ value }: { value: string }) {
  const { messages } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const options = [
    { v: "popular", label: messages.catalog.sortPopular },
    { v: "new", label: messages.catalog.sortNew },
    { v: "price_asc", label: messages.catalog.sortPriceAsc },
    { v: "price_desc", label: messages.catalog.sortPriceDesc },
  ];
  return (
    <label className="flex items-center gap-2 text-small text-ink-2">
      <span className="sr-only md:not-sr-only">{messages.catalog.sort}</span>
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set("sort", e.target.value);
          next.delete("page");
          router.push(`${pathname}?${next.toString()}`, { scroll: false });
        }}
        className="h-10 rounded-control border border-line bg-card px-3 text-small text-ink hover:border-line-strong focus:border-action focus:outline-none pointer-coarse:h-11"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
