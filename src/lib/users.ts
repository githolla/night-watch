import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

export type AppRole = "admin" | "member";
export type AppUser = { id: string; email: string; name: string; owner: Owner; role: AppRole };

const SHARED_OWNER_EMAIL = process.env.SHARED_OWNER_EMAIL || "josh@nine-67.com";

/** The fallback admin used when someone signs in with the shared workspace password (or holds a legacy session),
 *  so the workspace is never locked out before real user accounts exist. */
export function bootstrapAdmin(): AppUser {
  return { id: "bootstrap", email: SHARED_OWNER_EMAIL, name: "Workspace admin", owner: "josh", role: "admin" };
}

/** Load a real user by id. Returns null if the table doesn't exist yet (pre-migration) or the row is gone. */
export async function loadUser(id: string): Promise<AppUser | null> {
  try {
    const { data } = await admin().from("app_users").select("id,email,name,owner,role").eq("id", id).maybeSingle();
    if (!data) return null;
    return { id: data.id as string, email: data.email as string, name: data.name as string, owner: (data.owner as Owner) ?? "josh", role: (data.role as AppRole) ?? "member" };
  } catch {
    return null;
  }
}

/** Look up a user by email for login. Null on no match or missing table. */
export async function userByEmail(email: string): Promise<(AppUser & { password_hash: string }) | null> {
  try {
    const { data } = await admin().from("app_users").select("id,email,name,owner,role,password_hash").eq("email", email.toLowerCase().trim()).maybeSingle();
    if (!data) return null;
    return { id: data.id as string, email: data.email as string, name: data.name as string, owner: (data.owner as Owner) ?? "josh", role: (data.role as AppRole) ?? "member", password_hash: data.password_hash as string };
  } catch {
    return null;
  }
}
