import { NextResponse, type NextRequest } from "next/server";

/** Sends locale-less site URLs ("/", "/catalog") to /uz or /ru, remembering the visitor's choice. /tma, /admin, /api and assets are untouched. */
export function proxy(request: NextRequest) {
  const cookie = request.cookies.get("shop_locale")?.value;
  const header = request.headers.get("accept-language") ?? "";
  const locale = cookie === "ru" || cookie === "uz" ? cookie : /^\s*ru\b/i.test(header) || /(^|,)\s*ru\b/i.test(header) ? "ru" : "uz";
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|media|hooks|tma|admin|dev|uz|ru|_next|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.[a-zA-Z0-9]+$).*)"],
};
