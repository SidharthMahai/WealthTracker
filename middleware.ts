import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "wealthtracker_auth";

function isPublicPath(pathname: string) {
  if (pathname === "/login") return true;
  if (pathname === "/api/auth") return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/robots.txt") return true;
  if (pathname === "/sitemap.xml") return true;

  // Assets with extensions.
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return true;

  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const authed = request.cookies.get(COOKIE_NAME)?.value === "1";
  if (authed) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: "/:path*",
};
