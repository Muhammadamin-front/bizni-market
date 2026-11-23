import type { Locale, PublicConfig } from "@shop/shared";
import { getMessagesWithContent } from "@shop/shared";
import Link from "next/link";

/** The footer only shows what the owner has entered in the admin (contacts, hours, delivery text). Nothing here is invented. */
export function Footer({ locale, content, botUsername }: { locale: Locale; content: PublicConfig["content"]; botUsername: string | null }) {
  const m = getMessagesWithContent(locale, content);
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
      <div className="border-t border-line">
       <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-4 lg:px-6">
        <p className="text-caption text-ink-2">{m.footer.rights(m.brand.name)}</p>
        {/* /admin has its own login and is not localized; no prefetch so visitors never load admin code. */}
        <Link
          href="/admin"
          prefetch={false}
          rel="nofollow"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line-strong bg-card px-4 text-small font-semibold text-ink hover:border-ink/50 hover:bg-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          {m.footer.admin}
        </Link>
       </div>
      </div>
    </footer>
  );
}
