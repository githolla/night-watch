import { requireUser } from "@/lib/auth";
import { recordCardOutcome } from "@/lib/manual-outreach";
import { z } from "zod";

const input = z.object({ outcome: z.enum(["positive", "neutral", "objection", "referral", "ooo", "negative", "meeting"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const { outcome } = input.parse(await request.json());
    return Response.json(await recordCardOutcome(id, outcome));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Outcome failed" }, { status: 400 });
  }
}
