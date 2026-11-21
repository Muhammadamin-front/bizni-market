import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const origin = (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/tma", "/api", "/*/cart", "/*/checkout", "/*/order/", "/dev"] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
