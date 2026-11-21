import { getMessages, isLocale } from "@shop/shared";
import { notFound } from "next/navigation";
import { getConfig } from "@/lib/server-api";

export const dynamic = "force-dynamic";
const TITLES = { about: "about", delivery: "delivery", offer: "offer", privacy: "privacy" } as const;

/** Static pages (about, delivery, offer, privacy) hold exactly what the owner typed in the admin, as plain text. No page without text. */
export default async function StaticPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isLocale(locale) || !(slug in TITLES)) notFound();
  const config = await getConfig();
  const block = config.content[`page.${slug}`];
  const body = block?.[locale] || block?.uz || "";
  if (!body) notFound();
  const m = getMessages(locale);
  const title = m.footer[TITLES[slug as keyof typeof TITLES]];
  return (
    <article className="mx-auto max-w-2xl">
      <h1 className="text-title font-bold">{title}</h1>
      {body.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="mt-4 whitespace-pre-line text-body text-pretty">{para}</p>
      ))}
    </article>
  );
}
