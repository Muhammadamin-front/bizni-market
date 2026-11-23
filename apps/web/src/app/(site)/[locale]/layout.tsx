import { isLocale, LOCALES, type Locale } from "@shop/shared";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Footer } from "@/components/site/Footer";
import { SiteHeader } from "@/components/site/SiteHeader";
import { fontClass } from "@/lib/fonts";
import { I18nProvider } from "@/lib/i18n";
import { getConfig } from "@/lib/server-api";
import { ToastProvider } from "@/lib/toast";
import { getMessagesWithContent } from "@shop/shared";
import "../../globals.css";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f6f3ee" };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const config = await getConfig().catch(() => null);
  const m = getMessagesWithContent(isLocale(locale) ? locale : "uz", config?.content);
  const origin = process.env.PUBLIC_URL ?? "http://localhost:3000";
  return {
    metadataBase: new URL(origin),
    title: { default: m.brand.name, template: `%s · ${m.brand.name}` },
    description: m.home.heroBody,
    alternates: { languages: { uz: "/uz", ru: "/ru" } },
    openGraph: { siteName: m.brand.name, locale: locale === "ru" ? "ru_RU" : "uz_UZ", type: "website" },
  };
}

export default async function SiteLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const config = await getConfig().catch(() => null);
  const m = getMessagesWithContent(locale, config?.content);

  return (
    <html lang={locale} className={fontClass} suppressHydrationWarning>
      <head>
        {/* Applies the saved day/night choice before first paint, so the page never flashes light. */}
        <script dangerouslySetInnerHTML={{ __html: 'try{if(localStorage.getItem("kanso-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}' }} />
      </head>
      <body>
        <I18nProvider locale={locale} prefix={`/${locale}`} content={config?.content}>
          <ToastProvider>
            {config?.demo ? <p className="bg-ink px-4 py-1.5 text-center text-caption text-white">{m.home.demoBanner}</p> : null}
            <Suspense>
              <SiteHeader />
            </Suspense>
            <main className="mx-auto min-h-[60vh] max-w-[1280px] px-4 py-6 lg:px-6">{children}</main>
            <Footer locale={locale} content={config?.content ?? {}} botUsername={config?.botUsername ?? null} />
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
