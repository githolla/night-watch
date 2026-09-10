import { SESSION_COOKIE, SESSION_MAX_AGE, sharedSessionToken, validSharedPassword } from "@/lib/shared-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const input = z.object({ password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  try {
    const { password } = input.parse(await request.json());
    if (!validSharedPassword(password)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return Response.json({ error: "That password is not correct." }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, sharedSessionToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
      priority: "high",
    });
    return response;
  } catch {
    return Response.json({ error: "Enter the shared workspace password." }, { status: 400 });
  }
}
