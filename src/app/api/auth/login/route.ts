import { SESSION_COOKIE, validSharedPassword } from "@/lib/shared-auth";
import { issueSession, SESSION_MAX_AGE } from "@/lib/session";
import { userByEmail } from "@/lib/users";
import { verifyPassword } from "@/lib/passwords";
import { admin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { z } from "zod";

const input = z.object({ email: z.string().max(200).optional(), password: z.string().min(1).max(200) });

function setSession(token: string) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    priority: "high",
  });
  return response;
}

export async function POST(request: Request) {
  try {
    const { email, password } = input.parse(await request.json());

    // Real per-user login when an email is given.
    if (email && email.trim()) {
      const user = await userByEmail(email);
      if (user && verifyPassword(password, user.password_hash)) {
        try { await admin().from("app_users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id); } catch { /* best-effort */ }
        return setSession(issueSession(user.id));
      }
      // Fall through: allow the shared password even with an email typed, so the admin can always get in.
    }

    // Shared workspace password → bootstrap admin (also the pre-migration path).
    if (validSharedPassword(password)) return setSession(issueSession(null, true));

    await new Promise((resolve) => setTimeout(resolve, 500));
    return Response.json({ error: "Those sign-in details are not correct." }, { status: 401 });
  } catch {
    return Response.json({ error: "Enter your email and password." }, { status: 400 });
  }
}
