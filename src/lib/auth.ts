import { ACTING_COOKIE, actingTarget } from "./acting-session.ts";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./shared-auth.ts";
import { readSession } from "./session.ts";
import { sessionRevoked } from "./session-revocation.ts";
import { bootstrapAdmin, loadUser, type AppUser } from "./users.ts";

/** The signed-in user for this request. Resolves a per-user session first, then honours the shared-password
 *  session as the bootstrap admin so the workspace is never locked out. Throws when unauthenticated, when the
 *  token was signed out, or when the user's password changed after it was issued. The legacy fixed HMAC
 *  cookie is no longer accepted: one value shared by everyone can never be revoked. */
export async function requireActualUser(): Promise<AppUser> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = readSession(token);
  if (session && !(await sessionRevoked(session))) {
    if (session.uid) {
      const user = await loadUser(session.uid);
      if (user && (user.sessionVersion === undefined || user.sessionVersion === session.sv)) return user;
    } else if (session.boot) return bootstrapAdmin();
  }
  throw new Error("Unauthorized");
}

export async function requireUser(): Promise<AppUser> {
  const actual = await requireActualUser();
  const token = (await cookies()).get(ACTING_COOKIE)?.value;
  if (!token) return actual;
  const target = await loadUser(actingTarget(token, actual));
  if (!target) throw new Error("Act-as account unavailable. Exit admin mode.");
  return { ...target, actor: { id: actual.id, name: actual.name, email: actual.email } };
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireActualUser();
  if (user.role !== "admin") throw new Error("Admins only");
  return user;
}

/** For routes whose catch blocks map every error to a 500: answer 401/403 up front, or null to proceed. */
export async function adminGate(): Promise<Response | null> {
  const user = await requireActualUser().catch(() => null);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Only an admin can start research or bulk changes. They spend the model budget or rewrite every draft." }, { status: 403 });
  return null;
}

export function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // A cron endpoint with no secret set is a dead cron: it would run for anyone. Log loudly and refuse.
    console.error("[cron] CRON_SECRET is not set — cron endpoint refusing all requests");
    return false;
  }
  const expected = `Bearer ${secret}`;
  const got = request.headers.get("authorization") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  // Constant-time compare so a wrong secret can't be recovered byte-by-byte from response timing.
  return a.length === b.length && timingSafeEqual(a, b);
}
