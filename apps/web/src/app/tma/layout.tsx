import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { getMessagesWithContent } from "@shop/shared";
import { fontClass } from "@/lib/fonts";
import { getConfig } from "@/lib/server-api";
import "../globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const name = getMessagesWithContent("uz", (await getConfig().catch(() => null))?.content).brand.name;
  return { title: name, robots: { index: false, follow: false } };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: "#f6f3ee" };

export default function TmaRootLayout({ children }: { children: ReactNode }) {
  return (
    // Telegram's script sets --tg-viewport-* on <html> before React hydrates; that one-element difference is expected.
    <html lang="uz" className={fontClass} suppressHydrationWarning>
      <body className="overscroll-none">
        {/* Telegram's official bridge. It only exists inside Telegram clients; elsewhere the app falls back to the dev stand-in (when enabled). */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
