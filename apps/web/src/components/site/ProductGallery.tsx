"use client";

import type { ProductImageDTO } from "@shop/shared";
import { Package } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";

export function ProductGallery({ images, name }: { images: ProductImageDTO[]; name: string }) {
  const { messages } = useI18n();
  const [index, setIndex] = useState(0);
  const current = images[index];
  return (
    <div>
      <div className={`flex aspect-square items-center justify-center overflow-hidden rounded-card border border-line ${current ? "bg-white" : "bg-sunken p-4"}`}>
        {current ? (
          // Our own 1:1 white-background copy of the photo, pre-sized; dimensions set to avoid layout shift.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.large} srcSet={`${current.medium} 400w, ${current.large} 1000w`} sizes="(min-width: 1024px) 480px, 100vw" alt={name} width={1000} height={1000} className="size-full object-contain" fetchPriority="high" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-ink-2">
            <Package aria-hidden className="size-16" strokeWidth={1.25} />
            <span className="text-small">{messages.productPage.noPhoto}</span>
          </div>
        )}
      </div>
      {images.length > 1 ? (
        <ul className="mt-3 flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <li key={img.small}>
              <button type="button" onClick={() => setIndex(i)} aria-label={messages.productPage.imageOf(i + 1, images.length)} aria-current={i === index} className={`size-16 overflow-hidden rounded-control border-2 bg-white ${i === index ? "border-ink" : "border-line hover:border-line-strong"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.small} alt="" width={160} height={160} loading="lazy" className="size-full object-contain" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
