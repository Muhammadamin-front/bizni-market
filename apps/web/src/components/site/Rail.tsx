import type { ProductCardData } from "@shop/shared";
import Link from "next/link";
import { ProductTile } from "@/components/ProductTile";
import { RailList } from "./RailList";

/** A titled horizontal rail of products (home page). Renders nothing when empty: a section with no data is not shown. */
export function Rail({ title, products, moreHref, moreLabel }: { title: string; products: ProductCardData[]; moreHref?: string; moreLabel?: string }) {
  if (products.length === 0) return null;
  return (
    <section className="mt-10" aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lead font-bold">{title}</h2>
        {moreHref ? (
          <Link href={moreHref} className="text-small font-semibold text-link hover:underline">
            {moreLabel}
          </Link>
        ) : null}
      </div>
      <RailList>
        {products.map((p) => (
          <li key={p.id}>
            <ProductTile product={p} />
          </li>
        ))}
      </RailList>
    </section>
  );
}
