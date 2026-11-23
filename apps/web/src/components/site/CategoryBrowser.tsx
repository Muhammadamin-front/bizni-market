import type { CategoryNode, Locale } from "@shop/shared";
import { getMessages } from "@shop/shared";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { CategoryArt } from "@/components/CategoryArt";

/**
 * The shop sections (roots: stationery, computers and services, ...) stay separate: each one is a small heading over its own
 * sub-categories, so the sections never mix. A section with no sub-categories yet is shown as a single card.
 */
function groups(roots: CategoryNode[]): { root: CategoryNode; items: CategoryNode[]; heading: boolean }[] {
  return roots.map((root) => (root.children.length > 0 ? { root, items: root.children, heading: roots.length > 1 } : { root, items: [root], heading: false }));
}

/**
 * The category list of the catalogue page: one card per category (picture, name, chevron) in a tinted panel. Picking one
 * shows its products beside the list (/catalog?category=slug), so the list stays on screen while browsing.
 */
export function CategoryBrowser({ roots, locale, active, basePath }: { roots: CategoryNode[]; locale: Locale; active?: string; basePath?: string }) {
  const m = getMessages(locale);
  const base = basePath ?? `/${locale}/catalog`;
  return (
    <aside aria-label={m.catalog.categories} className="w-full shrink-0 self-start rounded-[14px] bg-tint p-2 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:w-[316px] lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:thin]">
      <h2 className="px-2 pt-2 pb-3 text-small font-bold">{m.catalog.categories}</h2>
      <div className="flex flex-col gap-4">
        {groups(roots).map(({ root, items, heading }) => (
          <section key={root.id} aria-label={heading ? root.name : undefined}>
            {heading ? (
              <h3 className="px-2 pb-2">
                <Link href={`${base}?category=${encodeURIComponent(root.slug)}`} className="text-caption font-bold tracking-wide text-ink-2 uppercase hover:text-ink">
                  {root.name}
                </Link>
              </h3>
            ) : null}
            <ul className="flex flex-col gap-2">
              {items.map((c) => {
                const current = c.slug === active;
                const picture = c.imageUrl ?? c.covers[0];
                return (
                  <li key={c.id}>
                    <Link
                      href={`${base}?category=${encodeURIComponent(c.slug)}`}
                      aria-current={current ? "true" : undefined}
                      className={`group flex min-h-14 items-center gap-3 rounded-[10px] border bg-card px-2 py-2 transition-colors duration-150 ${current ? "border-action" : "border-transparent hover:border-line-strong"}`}
                    >
                      <span aria-hidden className="relative size-10 shrink-0 overflow-hidden rounded-[8px] bg-white">
                        {picture ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={picture} alt="" loading="lazy" className="size-full object-cover" />
                        ) : (
                          <CategoryArt name={c.name} size="sm" />
                        )}
                      </span>
                      <span className={`min-w-0 flex-1 text-small leading-tight font-medium uppercase ${current ? "text-link" : ""}`}>{c.name}</span>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-2 transition-transform duration-150 group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
