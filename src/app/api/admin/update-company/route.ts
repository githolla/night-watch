import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200).optional(),
  vertical: z.string().trim().max(200).optional(),
  tier: z.enum(["A1", "A2", "B", "C"]).optional(),
  outreach: z.boolean().optional(),
});

/**
 * Adjust a company already on the file: its name, industry, priority tier, and whether it is being reached
 * out to. Adding and excluding were the only two things possible before, so correcting a wrong tier or a
 * mis-typed name meant re-adding the company over the top of itself.
 *
 * Every change here is marked hand-decided (outreach_manual), which is what stops the nightly file import
 * putting its own values back over yours.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const parsed = input.parse(await request.json().catch(() => ({})));
    const db = admin();

    const { data: existing } = await db.from("accounts").select("id,name,domain").eq("id", parsed.id).maybeSingle();
    if (!existing) return Response.json({ error: "That company is no longer on the list." }, { status: 404 });

    const patch: Record<string, unknown> = { outreach_manual: true };
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.vertical !== undefined) patch.vertical = parsed.vertical;
    if (parsed.tier !== undefined) patch.tier = parsed.tier;
    if (parsed.outreach !== undefined) patch.outreach = parsed.outreach;
    // A company being reached out to has to be active — otherwise it is on the list but invisible to
    // every run, which reads as "I turned it on and nothing happened".
    if (parsed.outreach === true) patch.status = "active";

    const { data, error } = await db.from("accounts").update(patch).eq("id", parsed.id)
      .select("id,name,domain,vertical,tier,outreach,status").single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, account: data });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the company" }, { status: 400 });
  }
}
