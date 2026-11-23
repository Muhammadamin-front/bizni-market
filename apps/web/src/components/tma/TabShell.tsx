"use client";

import type { PublicConfig } from "@shop/shared";
import { BottomTabBar } from "@shop/ui";
import { Heart, Home, LayoutGrid, ShoppingBasket, User } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeStyle } from "@/components/ThemeStyle";
import { useCart } from "@/lib/cart";
import { FavoritesProvider } from "@/lib/favorites";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { ToastProvider } from "@/lib/toast";
import { TmaProvider, useBackButton } from "@/lib/tma";
import { useFetch } from "@/lib/use-fetch";

const TAB_ROOTS = ["/tma", "/tma/catalog", "/tma/favorites", "/tma/cart", "/tma/profile"];

export function TmaApp({ children }: { children: ReactNode }) {
  // The Mini App shows the same owner-edited texts and colours as the website.
  const { data: config } = useFetch<PublicConfig>("/api/v1/config");
  return (
    <TmaProvider>
      {(s) => (
        <I18nProvider locale={s.locale} prefix="/tma" content={config?.content}>
          <ThemeStyle content={config?.content} />
          <ToastProvider>
            <FavoritesProvider token={s.token}>
              <Gate phase={s.phase} devMode={s.devMode}>{children}</Gate>
            </FavoritesProvider>
          </ToastProvider>
        </I18nProvider>
      )}
    </TmaProvider>
  );
}

function Gate({ phase, devMode, children }: { phase: string; devMode: boolean; children: ReactNode }) {
  const { messages } = useI18n();
  if (phase === "connecting") return <p className="p-6 text-center text-ink-2">{messages.profile.connecting}</p>;
  if (phase === "needs-telegram") return <p className="p-8 text-center text-body text-ink-2">{messages.profile.needTelegram}</p>;
  if (phase === "error") return <p className="p-8 text-center text-body text-ink-2">{messages.errors.body}</p>;
  return <Shell devMode={devMode}>{children}</Shell>;
}

function Shell({ devMode, children }: { devMode: boolean; children: ReactNode }) {
  const { messages, href } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const { count } = useCart();
  const isRoot = TAB_ROOTS.includes(pathname.replace(/\/$/, "") || "/tma");
  useBackButton(!isRoot, () => router.back());

  const active = pathname.startsWith("/tma/cart") || pathname.startsWith("/tma/checkout") ? "cart" : pathname.startsWith("/tma/catalog") || pathname.startsWith("/tma/p/") ? "catalog" : pathname.startsWith("/tma/favorites") ? "favorites" : pathname.startsWith("/tma/profile") || pathname.startsWith("/tma/orders") || pathname.startsWith("/tma/order/") ? "profile" : "home";
  const go: Record<string, string> = { home: "/", catalog: "/catalog", favorites: "/favorites", cart: "/cart", profile: "/profile" };

  return (
    <div className="flex min-h-dvh flex-col">
      {devMode ? <p className="bg-ink px-3 py-1 text-center text-caption text-white">{messages.profile.devNotice}</p> : null}
      <main className="flex-1 px-3 pt-3 pb-24">{children}</main>
      <BottomTabBar
        className="fixed inset-x-0 bottom-0 z-30"
        label={messages.nav.mainNav}
        activeId={active}
        onSelect={(id) => router.push(href(go[id] ?? "/"))}
        items={[
          { id: "home", label: messages.nav.home, icon: <Home aria-hidden className="size-6" /> },
          { id: "catalog", label: messages.nav.catalog, icon: <LayoutGrid aria-hidden className="size-6" /> },
          { id: "favorites", label: messages.nav.favorites, icon: <Heart aria-hidden className="size-6" /> },
          { id: "cart", label: messages.nav.cart, icon: <ShoppingBasket aria-hidden className="size-6" />, badge: count },
          { id: "profile", label: messages.nav.profile, icon: <User aria-hidden className="size-6" /> },
        ]}
      />
    </div>
  );
}
