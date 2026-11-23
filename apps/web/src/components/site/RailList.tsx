"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * The scrolling strip of a home-page rail. Phones swipe (the next card peeks in at the edge); on desktop whole cards fill
 * the row exactly (none cut in half) and two arrow buttons page through the rest.
 */
export function RailList({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const ref = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [update]);

  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth, behavior: "smooth" });
  const arrow =
    "absolute top-[38%] z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-card text-ink shadow-[0_6px_18px_-8px_rgba(27,27,31,0.45)] transition-opacity hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-action disabled:pointer-events-none disabled:opacity-0 lg:flex";

  return (
    <div className="relative">
      <ul
        ref={ref}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden [&>li]:w-44 [&>li]:shrink-0 [&>li]:snap-start sm:[&>li]:w-52 lg:[&>li]:w-[calc((100%-3rem)/5)] xl:[&>li]:w-[calc((100%-3.75rem)/6)]"
      >
        {children}
      </ul>
      <button type="button" className={`${arrow} -left-5`} onClick={() => page(-1)} disabled={edges.start} aria-label={locale === "ru" ? "Назад" : "Orqaga"}>
        <ChevronLeft aria-hidden className="size-5" />
      </button>
      <button type="button" className={`${arrow} -right-5`} onClick={() => page(1)} disabled={edges.end} aria-label={locale === "ru" ? "Дальше" : "Keyingi"}>
        <ChevronRight aria-hidden className="size-5" />
      </button>
    </div>
  );
}
