import type { Locale, PublicConfig } from "@shop/shared";
import { getMessages } from "@shop/shared";
import Link from "next/link";

/** The footer only shows what the owner has entered in the admin (contacts, hours, delivery text). Nothing here is invented. */
export function Footer({ locale, content, botUsername }: { locale: Locale; content: PublicConfig["content"]; botUsername: string | null }) {
  const m = getMessages(locale);
  const text = (key: string) => content[key]?.[locale] || content[key]?.uz || "";
  const contacts = ["footer.phone", "footer.address", "footer.hours", "footer.email"].map(text).filter(Boolean);
  const pages = [
    { slug: "about", label: m.footer.about },
    { slug: "delivery", label: m.footer.delivery },
    { slug: "offer", label: m.footer.offer },
    { slug: "privacy", label: m.footer.privacy },
  ].filter((p) => text(`page.${p.slug}`));

  return (
    <footer className="mt-12 border-t border-line bg-card">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-8 sm:grid-cols-2 lg:px-6">
        <div>
          <p className="text-lead font-bold">{m.brand.name}</p>
          {contacts.length ? (
            <div className="mt-3">
              <p className="text-small font-semibold">{m.footer.contacts}</p>
              <ul className="mt-1 space-y-1 text-small text-ink-2">
                {contacts.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {botUsername ? (
            <a href={`https://t.me/${botUsername}`} className="mt-3 inline-block text-small font-semibold text-action underline underline-offset-4" rel="noopener">
              {m.footer.openBot}
            </a>
          ) : null}
        </div>
        {pages.length ? (
          <div>
            <p className="text-small font-semibold">{m.footer.info}</p>
            <ul className="mt-1 space-y-1 text-small">
              {pages.map((p) => (
                <li key={p.slug}>
                  <Link href={`/${locale}/page/${p.slug}`} className="text-ink-2 hover:text-ink hover:underline">
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <p className="border-t border-line px-4 py-4 text-center text-caption text-ink-2">{m.footer.rights(m.brand.name)}</p>
    </footer>
  );
}
