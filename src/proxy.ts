import { SESSION_COOKIE, validSharedSession } from "@/lib/shared-auth";
import { readSession } from "@/lib/session";
import { NextResponse, type NextRequest } from "next/server";

function isPublicPath(pathname: string) {
  return pathname === "/setup" || pathname === "/api/health" || pathname.startsWith("/invite/") || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/cron/") || pathname.startsWith("/api/slack/") || pathname.startsWith("/api/gmail/callback") || pathname.startsWith("/api/unsubscribe") || /\.[a-z0-9]+$/i.test(pathname);
}

/** Per-user and bootstrap-admin logins issue an AES-GCM session (readSession); legacy shared-password
 *  cookies are HMAC tokens (validSharedSession). The gate must accept either, or every real login loops
 *  back to /login because the freshly-issued cookie isn't recognised here. */
function isAuthenticated(token: string | undefined) {
  return Boolean(readSession(token)) || validSharedSession(token);
}

export function proxy(request: NextRequest) {
  const authenticated = isAuthenticated(request.cookies.get(SESSION_COOKIE)?.value);
  if (request.nextUrl.pathname === "/login") {
    return authenticated ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (!authenticated && !isPublicPath(request.nextUrl.pathname)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
