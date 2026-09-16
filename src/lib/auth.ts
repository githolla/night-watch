import { cookies } from "next/headers";
import { SESSION_COOKIE, validSharedSession } from "./shared-auth.ts";
import { readSession } from "./session.ts";
import { bootstrapAdmin, loadUser, type AppUser } from "./users.ts";

/** The signed-in user for this request. Resolves a per-user session first, then honours the shared-password
 *  (or legacy) session as the bootstrap admin so the workspace is never locked out. Throws when unauthenticated. */
export async function requireUser(): Promise<AppUser> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = readSession(token);
  if (session) {
    if (session.uid) {
      const user = await loadUser(session.uid);
      if (user) return user;
    }
    if (session.boot) return bootstrapAdmin();
  }
  // Legacy shared-session cookies (issued before per-user auth) keep working as the bootstrap admin.
  if (validSharedSession(token)) return bootstrapAdmin();
  throw new Error("Unauthorized");
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Admins only");
  return user;
}

export function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}
