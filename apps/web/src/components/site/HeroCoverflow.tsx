"use client";

import type { BannerDTO, Locale } from "@shop/shared";
import { getMessages } from "@shop/shared";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";

/**
 * Home banners as a 3D cover-flow (adapted from Prompts/prompt.md): the current banner sits flat in front, its neighbours turn
 * away on both sides, and the band behind takes the current photo's colour as a blurred ambience. Banners are the owner's
 * (admin → Sayt matnlari), so the hero changes without a release. Arrow keys work while the carousel has focus, a swipe works
 * on phones, autoplay pauses on hover/focus and is off entirely for people who ask for reduced motion.
 */
export function HeroCoverflow({ banners, locale }: { banners: BannerDTO[]; locale: Locale }) {
  const m = getMessages(locale);
  const items = banners.filter((b) => b.imageUrl);
  const total = items.length;
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const touchX = useRef(0);

  const go = useCallback((i: number) => setCurrent(((i % total) + total) % total), [total]);
  const next = useCallback(() => go(current + 1), [go, current]);
  const prev = useCallback(() => go(current - 1), [go, current]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduced(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  useEffect(() => {
    if (reduced || paused || total <= 1) return;
    const t = setInterval(() => setCurrent((c) => (c + 1) % total), 6000);
    return () => clearInterval(t);
  }, [reduced, paused, total]);

  if (total === 0) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    }
  };
  const onTouchStart = (e: TouchEvent) => {
    touchX.current = e.touches[0]!.clientX;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const d = e.changedTouches[0]!.clientX - touchX.current;
    if (Math.abs(d) > 45) (d < 0 ? next : prev)();
  };

  const href = (b: BannerDTO) => (b.linkUrl.startsWith("/") ? `/${locale}${b.linkUrl === "/" ? "" : b.linkUrl}` : b.linkUrl);
  // Banner files exist at 160/400/1000 px wide; the URL from the API is the 1000 px one.
  const sized = (url: string, w: 160 | 400 | 1000) => url.replace(/-1000\.webp$/, `-${w}.webp`);

  return (
    <section
      aria-roledescription="carousel"
      aria-label={m.home.offers}
      className="hero-flow relative -mx-4 overflow-hidden bg-[#141416] py-8 text-white select-none sm:py-10 lg:mx-0 lg:rounded-card"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={onKey}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Ambience: the current photo, blurred and darkened, so the band takes on each banner's colour. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* 160 px is plenty for a blur: a few KB instead of a full banner per slide. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={items[current]!.id} src={sized(items[current]!.imageUrl!, 160)} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-45 blur-3xl motion-safe:animate-[fade-in_900ms_ease-out]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(20,20,22,0.15)_0%,rgba(20,20,22,0.85)_100%)]" />
      </div>

      {/* The stage is the front card's own box, sized by CSS alone (no measuring, so nothing shifts while the page loads).
          Side cards move by a percentage of their own width. Taller on a phone so the title and button fit over the photo. */}
      <div className="relative mx-auto aspect-[25/23] w-[84%] [perspective:1400px] sm:aspect-video sm:w-[52%] sm:max-w-[620px]">
        {items.map((b, i) => {
          const offset = (i - current + total) % total;
          const left = offset === total - 1 || (total > 3 && offset === total - 2);
          const step = offset === 0 ? 0 : left ? total - offset : offset;
          const dir = left ? -1 : 1;
          const visible = step <= 2 && (total > 2 || step <= 1);
          const isCenter = step === 0;
          const x = step === 0 ? 0 : dir * (step === 1 ? 62 : 108);
          const scale = step === 0 ? 1 : step === 1 ? 0.82 : 0.66;
          const rot = step === 0 ? 0 : -dir * (step === 1 ? 26 : 40);
          return (
            <div
              key={b.id}
              role="group"
              aria-roledescription="slide"
              aria-label={m.home.slideOf(i + 1, total)}
              aria-hidden={!isCenter}
              onClick={() => !isCenter && go(i)}
              className={`absolute inset-0 overflow-hidden rounded-card bg-[#1d1d21] motion-safe:transition-[transform,opacity,filter] motion-safe:duration-700 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)] ${isCenter ? "shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]" : "cursor-pointer shadow-[0_14px_32px_-8px_rgba(0,0,0,0.6)]"}`}
              style={{
                transform: `translateX(${x}%) scale(${scale}) rotateY(${rot}deg)`,
                opacity: visible ? (isCenter ? 1 : step === 1 ? 0.7 : 0.35) : 0,
                filter: isCenter ? "none" : `brightness(${step === 1 ? 0.7 : 0.5})`,
                zIndex: 30 - step * 10,
                pointerEvents: visible ? "auto" : "none",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                // Side cards are small and dimmed: 400 px is enough. Only the front card picks a size for the screen.
                src={isCenter ? b.imageUrl! : sized(b.imageUrl!, 400)}
                srcSet={isCenter ? `${sized(b.imageUrl!, 400)} 400w, ${b.imageUrl!} 1000w` : undefined}
                sizes={isCenter ? "(min-width: 640px) 620px, 84vw" : undefined}
                alt=""
                className="absolute inset-0 size-full object-cover"
                loading={i === 0 ? "eager" : "lazy"}
                fetchPriority={i === 0 ? "high" : "low"}
                decoding="async"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_35%,rgba(0,0,0,0.78)_100%)]" />
              <div
                className={`absolute inset-x-0 bottom-0 flex flex-col items-start gap-1.5 p-4 sm:p-6 motion-safe:transition-[opacity,transform] motion-safe:duration-500 ${isCenter ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}
              >
                <h2 className="max-w-[22ch] text-lead font-bold text-balance [text-shadow:0_2px_12px_rgba(0,0,0,0.6)] sm:text-title">{b.title}</h2>
                {b.subtitle ? <p className="max-w-[44ch] text-small text-white/85 text-pretty sm:text-body">{b.subtitle}</p> : null}
                <Link
                  href={href(b)}
                  tabIndex={isCenter ? 0 : -1}
                  className="mt-2 inline-flex h-11 items-center gap-2 rounded-control bg-action px-5 text-small font-semibold text-white hover:bg-action-press focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {m.home.open}
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {total > 1 ? (
        <div className="relative mt-5 flex items-center justify-center gap-4">
          <button type="button" onClick={prev} aria-label={m.home.slidePrev} className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white">
            <ChevronLeft aria-hidden className="size-5" />
          </button>
          <div className="flex items-center gap-2">
            {items.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => go(i)}
                aria-label={m.home.slideOf(i + 1, total)}
                aria-current={i === current}
                className="flex h-6 items-center"
              >
                <span className={`block h-1.5 rounded-full motion-safe:transition-all motion-safe:duration-500 ${i === current ? "w-6 bg-white" : "w-1.5 bg-white/40"}`} />
              </button>
            ))}
          </div>
          <button type="button" onClick={next} aria-label={m.home.slideNext} className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white">
            <ChevronRight aria-hidden className="size-5" />
          </button>
        </div>
      ) : null}
    </section>
  );
}
