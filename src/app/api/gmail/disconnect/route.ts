import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({ owner: z.enum(["josh"]).default("josh") });

export async function POST(request: Request) {
  try {
    await requireUser();
    const { owner } = input.parse(await request.json().catch(() => ({})));
    await admin().from("gmail_connections").delete().eq("owner", owner);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Disconnect failed" }, { status: 400 });
  }
}
