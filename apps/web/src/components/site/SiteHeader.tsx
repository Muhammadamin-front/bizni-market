"use client";

import { LanguageSwitch } from "@shop/ui";
import { Home, LayoutGrid, ShoppingBasket } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCart } from "@/lib/cart";
import { setLocaleCookie, useI18n } from "@/lib/i18n";
import { SearchBox } from "./SearchBox";
import { ThemeToggle } from "./ThemeToggle";

/** Two bands, like mirl.uz: a thin grey utility bar (theme, language), then logo, search and the icon tabs. */
export function SiteHeader() {
  const { locale, messages, href } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const { count } = useCart();

  const other = (target: "uz" | "ru") => {
    const rest = pathname.replace(/^\/(uz|ru)/, "");
    const qs = params.toString();
    return `/${target}${rest}${qs ? `?${qs}` : ""}`;
  };

  const path = pathname.replace(/^\/(uz|ru)/, "") || "/";
  const tabs = [
    { to: "/", label: messages.nav.home, Icon: Home, active: path === "/", badge: 0 },
    { to: "/catalog", label: messages.nav.catalog, Icon: LayoutGrid, active: path.startsWith("/catalog") || path.startsWith("/c/") || path.startsWith("/b/") || path.startsWith("/p/"), badge: 0 },
    { to: "/cart", label: messages.nav.cart, Icon: ShoppingBasket, active: path.startsWith("/cart") || path.startsWith("/checkout"), badge: count },
  ];

  return (
    <header className="sticky top-0 z-30 bg-card">
      <div className="bg-[#e6e8ee] text-ink">
        <div className="mx-auto flex max-w-[1280px] items-center justify-end gap-3 px-4 py-1 lg:px-6">
          <ThemeToggle />
          <LanguageSwitch
            value={locale}
            label={messages.language.label}
            options={[{ locale: "uz", label: messages.language.uz }, { locale: "ru", label: messages.language.ru }]}
            onChange={(l) => {
              setLocaleCookie(l);
              window.location.assign(other(l));
            }}
          />
        </div>
      </div>
      <div className="border-b border-line">
        <div className="mx-auto grid max-w-[1280px] grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:grid-cols-[auto_minmax(0,36rem)_1fr] lg:px-6">
          <Link href={href("/")} className="inline-flex h-11 items-center text-lead font-extrabold tracking-tight">
            {messages.brand.name}
          </Link>
          <div className="col-span-2 row-start-2 lg:col-span-1 lg:col-start-2 lg:row-start-1">
            <SearchBox submitLabel={messages.search.submit} />
          </div>
          <nav aria-label={messages.nav.mainNav} className="col-start-2 row-start-1 flex items-center justify-end gap-1 lg:col-start-3">
            {tabs.map(({ to, label, Icon, active, badge }) => (
              <Link
                key={to}
                href={href(to === "/" ? "/" : to)}
                aria-current={active ? "page" : undefined}
                aria-label={badge ? `${label}: ${messages.cart.items(badge)}` : label}
                className={`relative flex min-w-14 flex-col items-center gap-0.5 rounded-[10px] px-2.5 py-1.5 text-[0.6875rem] leading-tight font-medium transition-colors duration-150 ${active ? "bg-[#eef1ff] text-action" : "text-ink-2 hover:text-ink"}`}
              >
                <Icon aria-hidden className="size-6" strokeWidth={1.5} />
                {label}
                {badge > 0 ? <span className="tnum pointer-events-none absolute top-0.5 right-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-action px-1 text-[0.625rem] leading-4 font-bold text-white">{badge}</span> : null}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
