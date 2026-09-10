import { SESSION_COOKIE, validSharedSession } from "@/lib/shared-auth";
import { NextResponse, type NextRequest } from "next/server";

function isPublicPath(pathname: string) {
  return pathname === "/setup" || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/cron/") || pathname.startsWith("/api/slack/") || pathname.startsWith("/api/gmail/callback") || /\.[a-z0-9]+$/i.test(pathname);
}

export function proxy(request: NextRequest) {
  const authenticated = validSharedSession(request.cookies.get(SESSION_COOKIE)?.value);
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
