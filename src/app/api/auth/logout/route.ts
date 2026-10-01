import { ACTING_COOKIE } from "@/lib/acting-session";
import { SESSION_COOKIE } from "@/lib/shared-auth";
import { readSession } from "@/lib/session";
import { revokeSession } from "@/lib/session-revocation";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  // Clearing the cookie only affects this browser. Record the token as revoked so a copy stops working too.
  await revokeSession(readSession((await cookies()).get(SESSION_COOKIE)?.value));
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(ACTING_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
