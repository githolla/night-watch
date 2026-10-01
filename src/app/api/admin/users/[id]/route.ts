import { requireAdmin } from "@/lib/auth";
import { hashPassword } from "@/lib/passwords";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const patch = z.object({
  name: z.string().min(1).max(120).optional(),
  owner: z.enum(["josh", "jenna"]).optional(),
  role: z.enum(["admin", "member"]).optional(),
  password: z.string().min(8).max(200).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const body = patch.parse(await request.json());
    const update: Record<string, unknown> = {};
    if (body.name) update.name = body.name.trim();
    if (body.owner) update.owner = body.owner;
    if (body.role) update.role = body.role;
    if (body.password) update.password_hash = hashPassword(body.password);
    if (Object.keys(update).length === 0) throw new Error("Nothing to change");
    const db = admin();
    const { error } = await db.from("app_users").update(update).eq("id", id);
    if (error) throw error;
    if (body.password) {
      // A reset password must also end the sessions issued under the old one, or a leaked cookie outlives
      // the reset by up to 30 days. Separate write: before migration 0026 the column is missing and the
      // password change above must still land.
      const { data: current } = await db.from("app_users").select("session_version").eq("id", id).maybeSingle();
      if (current) await db.from("app_users").update({ session_version: Number(current.session_version ?? 0) + 1 }).eq("id", id);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAdmin();
    const { id } = await context.params;
    if (me.id === id) throw new Error("You can't remove your own account while signed in.");
    const { error } = await admin().from("app_users").delete().eq("id", id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Delete failed" }, { status: 400 });
  }
}
