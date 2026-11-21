import type { ProductCardData } from "@shop/shared";
import Link from "next/link";
import { ProductTile } from "@/components/ProductTile";

/** A titled horizontal rail of products (home page). Renders nothing when empty: a section with no data is not shown. */
export function Rail({ title, products, moreHref, moreLabel }: { title: string; products: ProductCardData[]; moreHref?: string; moreLabel?: string }) {
  if (products.length === 0) return null;
  return (
    <section className="mt-10" aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lead font-bold">{title}</h2>
        {moreHref ? (
          <Link href={moreHref} className="text-small font-semibold text-action hover:underline">
            {moreLabel}
          </Link>
        ) : null}
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {products.map((p) => (
          <li key={p.id} className="w-44 shrink-0 snap-start sm:w-52">
            <ProductTile product={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}
