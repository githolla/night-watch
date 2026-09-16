import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({
  from_name: z.string().max(120),
  title: z.string().max(120),
  signature: z.string().max(2000),
  website: z.string().max(160).optional(),
  location: z.string().max(160).optional(),
  cc: z.array(z.string().trim().min(3).max(160)).max(10),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = input.parse(await request.json());
    const db = admin();
    const { error } = await db.from("sender_profiles").upsert(
      { owner: user.owner, from_name: body.from_name, title: body.title, signature: body.signature, website: body.website ?? "", location: body.location ?? "", cc: body.cc, updated_at: new Date().toISOString() },
      { onConflict: "owner" },
    );
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Save failed" }, { status: 400 });
  }
}
