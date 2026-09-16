import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({
  path: z.string().max(300).default(""),
  category: z.enum(["bug", "idea", "confusing", "praise", "other"]).default("other"),
  rating: z.number().int().min(1).max(5).optional(),
  message: z.string().min(1).max(4000),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = input.parse(await request.json());
    const { error } = await admin().from("feedback").insert({
      user_email: user.email,
      user_name: user.name,
      path: body.path,
      category: body.category,
      rating: body.rating ?? null,
      message: body.message,
      user_agent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
    });
    if (error) throw new Error(/relation .*feedback.* does not exist/i.test(error.message) ? "Apply migration 0022 to enable feedback." : error.message);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not send feedback" }, { status: 400 });
  }
}
