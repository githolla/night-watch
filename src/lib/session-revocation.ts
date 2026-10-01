import { admin } from "./supabase/admin.ts";
import type { Session } from "./session.ts";

/**
 * Server-side half of signing out. The cookie alone cannot be recalled: a copy keeps working until it
 * expires. Logout records the token id here and every guarded request checks it. Before migration 0026 is
 * applied the table is missing; that reads as "not revoked" so a late migration never locks anyone out.
 */
export async function sessionRevoked(session: Session): Promise<boolean> {
  if (!session.jti) return false;
  try {
    const { data, error } = await admin().from("revoked_sessions").select("jti").eq("jti", session.jti).maybeSingle();
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

export async function revokeSession(session: Session | null) {
  if (!session?.jti) return;
  try {
    const db = admin();
    await db.from("revoked_sessions").upsert({ jti: session.jti, expires_at: new Date(session.exp).toISOString() }, { onConflict: "jti" });
    // Expired ids can never match a live cookie again; keep the table small.
    await db.from("revoked_sessions").delete().lt("expires_at", new Date().toISOString());
  } catch { /* best effort: the cookie is still cleared */ }
}
