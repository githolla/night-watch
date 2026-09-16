import { SESSION_COOKIE } from "@/lib/shared-auth";
import { issueSession, SESSION_MAX_AGE } from "@/lib/session";
import { hashPassword } from "@/lib/passwords";
import { admin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { z } from "zod";

const input = z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(200) });

export async function POST(request: Request) {
  try {
    const { token, password } = input.parse(await request.json());
    const db = admin();
    const { data: user } = await db.from("app_users").select("id,invite_expires_at").eq("invite_token", token).maybeSingle();
    if (!user) throw new Error("This invite link is invalid or has already been used.");
    if (user.invite_expires_at && Date.parse(user.invite_expires_at as string) < Date.now()) throw new Error("This invite has expired — ask an admin for a new one.");
    await db.from("app_users").update({ password_hash: hashPassword(password), invite_token: null, invite_expires_at: null, last_login_at: new Date().toISOString() }).eq("id", user.id);
    // Sign them straight in.
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, issueSession(user.id as string), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE, priority: "high" });
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not accept the invite" }, { status: 400 });
  }
}
