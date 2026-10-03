import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./server/auth/session";

/**
 * Optimistic auth check: unauthenticated visitors are sent to /login. Real authorization happens
 * in the data-access layer (requireUser) inside every page, action and route handler.
 */
const PUBLIC_PREFIXES = ["/login", "/api/media/", "/api/webhooks/", "/api/cron/", "/api/health", "/manifest.webmanifest", "/sw.js", "/icons/", "/offline"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  const secret = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : "dev-session-secret-change-me-dev-session-secret");
  const session = secret ? await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret) : null;
  if (session) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
