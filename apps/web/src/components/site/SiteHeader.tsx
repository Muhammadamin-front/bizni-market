"use client";

import { AppHeader, IconButton, LanguageSwitch } from "@shop/ui";
import { ShoppingBasket } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCart } from "@/lib/cart";
import { setLocaleCookie, useI18n } from "@/lib/i18n";
import { SearchBox } from "./SearchBox";

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

  return (
    <AppHeader
      brand={
        <Link href={href("/")} className="inline-flex h-11 items-center">
          {messages.brand.name}
        </Link>
      }
      trailing={
        <>
          <LanguageSwitch
            value={locale}
            label={messages.language.label}
            options={[{ locale: "uz", label: messages.language.uz }, { locale: "ru", label: messages.language.ru }]}
            onChange={(l) => {
              setLocaleCookie(l);
              window.location.assign(other(l));
            }}
          />
          <Link href={href("/cart")} aria-label={`${messages.nav.cart}${count ? `: ${messages.cart.items(count)}` : ""}`} className="relative">
            <IconButton aria-label={messages.nav.cart} tabIndex={-1} icon={<ShoppingBasket aria-hidden className="size-6" />} />
            {count > 0 ? (
              <span className="tnum pointer-events-none absolute top-0.5 right-0 inline-flex min-w-5 items-center justify-center rounded-full bg-action px-1 text-[0.6875rem] leading-5 font-bold text-white">{count}</span>
            ) : null}
          </Link>
        </>
      }
    >
      <SearchBox />
    </AppHeader>
  );
}
