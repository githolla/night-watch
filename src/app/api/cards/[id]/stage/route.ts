import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({
  stage: z.enum(["replied", "meeting", "qualified", "opportunity", "lost"]),
  note: z.string().max(400).optional(),
  valueUsd: z.number().int().min(0).max(100_000_000).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const { stage, note, valueUsd } = input.parse(await request.json());
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { stage_note: note ?? null };
    if (stage === "replied") patch.status = "replied";
    else if (stage === "meeting") { patch.status = "meeting"; patch.meeting_at = patch.meeting_at ?? now; }
    else if (stage === "qualified") { patch.status = "qualified"; patch.qualified_at = now; }
    else if (stage === "opportunity") { patch.status = "opportunity"; patch.opportunity_at = now; if (valueUsd != null) patch.opportunity_value_usd = valueUsd; }
    else if (stage === "lost") { patch.status = "dismissed"; }
    const { error } = await admin().from("cards").update(patch).eq("id", id);
    if (error) throw new Error(/invalid input value for enum|column .* does not exist/i.test(error.message) ? "Apply migration 0021 to enable the pipeline stages." : error.message);
    return Response.json({ ok: true, status: patch.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the stage" }, { status: 400 });
  }
}
