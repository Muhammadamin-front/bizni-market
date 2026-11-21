import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));
// Rewrites are compiled into the build. In Docker this is the compose service name (set by the build arg); locally it is the dev API.
const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const isProd = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy. Next injects small inline scripts, so script-src needs 'unsafe-inline' (a nonce CSP would force every page
 * to render dynamically); everything else is locked to our own origin. Telegram's script is allowed on /tma only, Cloudflare Turnstile
 * on the site checkout only, and only /tma may be framed (by Telegram clients).
 */
function csp(section: "site" | "tma" | "admin"): string {
  const script = ["'self'", "'unsafe-inline'", ...(section === "tma" ? ["https://telegram.org"] : []), ...(section === "site" ? ["https://challenges.cloudflare.com"] : [])];
  const frameAncestors = section === "tma" ? "https://web.telegram.org https://*.telegram.org https://telegram.org" : "'none'";
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${section === "site" ? " https://challenges.cloudflare.com" : ""}`,
    `frame-src ${section === "site" ? "https://challenges.cloudflare.com" : "'none'"}`,
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  output: "standalone",
  // The monorepo root, so the standalone trace includes the workspace packages.
  outputFileTracingRoot: path.join(here, "../.."),
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@shop/ui", "@shop/shared"],
  poweredByHeader: false,
  reactStrictMode: true,
  // Build-time switch. The shared-host release (deploy/server) runs from a read-only folder, so revalidated pages stay in memory
  // instead of being written next to the build. Docker keeps the default (write to disk).
  experimental: { isrFlushToDisk: process.env.NEXT_ISR_FLUSH_TO_DISK !== "false" },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/:path*` },
      { source: "/media/:path*", destination: `${API}/media/:path*` },
    ];
  },
  async headers() {
    if (!isProd) return [{ source: "/:path*", headers: baseHeaders }];
    return [
      { source: "/tma/:path*", headers: [...baseHeaders, { key: "Content-Security-Policy", value: csp("tma") }] },
      { source: "/tma", headers: [...baseHeaders, { key: "Content-Security-Policy", value: csp("tma") }] },
      { source: "/admin/:path*", headers: [...baseHeaders, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: csp("admin") }] },
      { source: "/admin", headers: [...baseHeaders, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: csp("admin") }] },
      { source: "/:locale(uz|ru)/:path*", headers: [...baseHeaders, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: csp("site") }] },
      { source: "/:locale(uz|ru)", headers: [...baseHeaders, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: csp("site") }] },
    ];
  },
};

export default config;
