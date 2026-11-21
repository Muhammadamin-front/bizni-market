import { DEFAULT_LOCALE, isLocale } from "@shop/shared";
import type { Metadata } from "next";
import { Gallery } from "./gallery";

export const metadata: Metadata = { title: "Design system", robots: { index: false, follow: false } };

export default async function DevUiPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  return <Gallery initialLocale={isLocale(lang) ? lang : DEFAULT_LOCALE} />;
}
