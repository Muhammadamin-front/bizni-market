import type { CategoryNode, Locale } from "@shop/shared";
import { getMessages } from "@shop/shared";
import { ArrowRight, Package } from "lucide-react";
import Link from "next/link";

/**
 * The two shops as two large doors (stationery, grocery), each showing three of its own product photos, then the sub-categories
 * as picture tiles. Photos come from the products themselves (CategoryNode.covers), so the owner never uploads category art.
 */
export function CategoryTiles({ roots, locale }: { roots: CategoryNode[]; locale: Locale }) {
  const m = getMessages(locale);
  const subs = roots.flatMap((r) => r.children);
  return (
    <section className="mt-10" aria-label={m.home.categories}>
      <h2 className="mb-4 text-title font-bold">{m.home.categories}</h2>

      <ul className={`grid gap-3 ${roots.length > 1 ? "md:grid-cols-2" : ""}`}>
        {roots.map((r) => (
          <li key={r.id}>
            <Link href={`/${locale}/c/${r.slug}`} className="group relative flex h-full min-h-44 overflow-hidden rounded-card border border-line bg-card transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-[0_10px_28px_-14px_rgba(27,27,31,0.35)]">
              <div className="flex flex-1 flex-col justify-between p-5">
                <div>
                  <p className="text-lead font-bold sm:text-title">{r.name}</p>
                  <p className="mt-1 text-small text-ink-2">{m.home.products(r.productCount)}</p>
                </div>
                <span className="mt-4 inline-flex items-center gap-1.5 text-small font-semibold text-action">
                  {m.home.open}
                  <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </span>
              </div>
              <div aria-hidden className="relative w-[42%] shrink-0 sm:w-[52%]">
                {r.covers.slice(0, 3).map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={src}
                    src={src}
                    alt=""
                    loading="lazy"
                    className="absolute size-[62%] rounded-control border-2 border-white bg-white object-cover shadow-[0_8px_20px_-10px_rgba(27,27,31,0.45)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{
                      top: ["8%", "28%", "50%"][i],
                      right: ["30%", "6%", "34%"][i],
                      transform: `rotate(${[-6, 5, -2][i]}deg)`,
                      zIndex: 3 - i,
                    }}
                  />
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {subs.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {subs.map((c) => (
            <li key={c.id}>
              <Link href={`/${locale}/c/${c.slug}`} className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-card transition-colors duration-200 hover:border-line-strong">
                <div className="relative aspect-[4/3] overflow-hidden bg-white">
                  {c.covers[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.covers[0]} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105" />
                  ) : (
                    <Package aria-hidden className="absolute inset-0 m-auto size-8 text-line-strong" strokeWidth={1.25} />
                  )}
                </div>
                <div className="flex flex-1 items-start justify-between gap-2 border-t border-line px-3 py-2.5">
                  <span className="text-small font-semibold leading-tight">{c.name}</span>
                  <span className="tnum text-caption text-ink-2">{c.productCount}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
