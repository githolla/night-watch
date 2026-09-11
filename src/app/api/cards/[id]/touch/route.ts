import { requireUser } from "@/lib/auth";
import { recordManualTouch } from "@/lib/manual-outreach";
import { z } from "zod";

const input = z.object({
  channel: z.enum(["linkedin_comment", "linkedin_request", "linkedin_message", "email", "intro_ask"]),
  body: z.string().max(5000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const body = input.parse(await request.json());
    const owner = "josh" as const;
    const data = await recordManualTouch(id, body.channel, owner, body.body);
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Touch failed" }, { status: 400 });
  }
}
