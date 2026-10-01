import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

export type AppRole = "admin" | "member";
export type AppUser = { id: string; email: string; name: string; owner: Owner; role: AppRole; sessionVersion?: number; actor?: { id: string; name: string; email: string } };

const SHARED_OWNER_EMAIL = process.env.SHARED_OWNER_EMAIL || "josh@nine-67.com";

/** The fallback admin used when someone signs in with the shared workspace password (or holds a legacy session),
 *  so the workspace is never locked out before real user accounts exist. */
export function bootstrapAdmin(): AppUser {
  return { id: "bootstrap", email: SHARED_OWNER_EMAIL, name: "Workspace admin", owner: "josh", role: "admin" };
}

/** Load a real user by id. Returns null if the table doesn't exist yet (pre-migration) or the row is gone.
 *  session_version arrives with migration 0026; before it exists the lookup retries without it, so a late
 *  migration never signs everyone out. */
export async function loadUser(id: string): Promise<AppUser | null> {
  try {
    const db = admin();
    let { data, error } = await db.from("app_users").select("id,email,name,owner,role,session_version").eq("id", id).maybeSingle();
    if (error) ({ data, error } = await db.from("app_users").select("id,email,name,owner,role").eq("id", id).maybeSingle());
    if (!data) return null;
    const version = (data as { session_version?: number }).session_version;
    return { id: data.id as string, email: data.email as string, name: data.name as string, owner: (data.owner as Owner) ?? "josh", role: (data.role as AppRole) ?? "member", ...(typeof version === "number" ? { sessionVersion: version } : {}) };
  } catch {
    return null;
  }
}

/** Look up a user by email for login. Null on no match or missing table. */
export async function userByEmail(email: string): Promise<(AppUser & { password_hash: string }) | null> {
  try {
    const db = admin(), address = email.toLowerCase().trim();
    let { data, error } = await db.from("app_users").select("id,email,name,owner,role,password_hash,session_version").eq("email", address).maybeSingle();
    if (error) ({ data, error } = await db.from("app_users").select("id,email,name,owner,role,password_hash").eq("email", address).maybeSingle());
    if (!data) return null;
    const version = (data as { session_version?: number }).session_version;
    return { id: data.id as string, email: data.email as string, name: data.name as string, owner: (data.owner as Owner) ?? "josh", role: (data.role as AppRole) ?? "member", password_hash: data.password_hash as string, ...(typeof version === "number" ? { sessionVersion: version } : {}) };
  } catch {
    return null;
  }
}
