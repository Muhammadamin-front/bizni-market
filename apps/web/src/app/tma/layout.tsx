import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { fontClass } from "@/lib/fonts";
import "../globals.css";

export const metadata: Metadata = { title: "Kanso", robots: { index: false, follow: false } };
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
