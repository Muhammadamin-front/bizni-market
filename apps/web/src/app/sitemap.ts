import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

/** Both languages of every public page, with hreflang alternates. Built from the same read model as the storefront. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
  const entry = (path: string, lastModified?: Date): MetadataRoute.Sitemap[number] => ({
    url: `${origin}/uz${path}`,
    lastModified,
    alternates: { languages: { uz: `${origin}/uz${path}`, ru: `${origin}/ru${path}` } },
  });
  try {
    const res = await fetch(`${api}/v1/sitemap`, { next: { revalidate: 600 } });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { products: { slug: string; updatedAt: string }[]; categories: { slug: string }[]; brands: { slug: string }[] };
    return [
      entry(""),
      entry("/catalog"),
      entry("/brands"),
      ...data.categories.map((c) => entry(`/c/${c.slug}`)),
      ...data.brands.map((b) => entry(`/b/${b.slug}`)),
      ...data.products.map((p) => entry(`/p/${p.slug}`, new Date(p.updatedAt))),
    ];
  } catch {
    return [entry("")];
  }
}
