import { requireAdmin } from "@/lib/auth";
import { hashPassword } from "@/lib/passwords";
import { admin } from "@/lib/supabase/admin";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const create = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(120),
  owner: z.enum(["josh", "jenna"]),
  role: z.enum(["admin", "member"]).default("member"),
  // Either send an invite (no password) or set a temp password directly.
  password: z.string().min(8).max(200).optional(),
});
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    await requireAdmin();
    const { data } = await admin().from("app_users").select("id,email,name,owner,role,created_at,last_login_at").order("created_at");
    return Response.json({ users: data ?? [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = create.parse(await request.json());
    const token = body.password ? null : randomBytes(24).toString("base64url");
    const { error } = await admin().from("app_users").insert({
      email: body.email.toLowerCase().trim(),
      name: body.name.trim(),
      owner: body.owner,
      role: body.role,
      password_hash: body.password ? hashPassword(body.password) : null,
      invite_token: token,
      invite_expires_at: token ? new Date(Date.now() + INVITE_TTL_MS).toISOString() : null,
    });
    if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "A user with that email already exists." : error.message);
    const base = process.env.APP_URL ?? new URL(request.url).origin;
    return Response.json({ ok: true, inviteUrl: token ? `${base}/invite/${token}` : null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not add the user" }, { status: 400 });
  }
}
