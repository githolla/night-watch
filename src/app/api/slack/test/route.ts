import { requireUser } from "@/lib/auth";
import { sendSlackTest } from "@/lib/slack";

export async function POST() {
  try {
    await requireUser();
    const result = await sendSlackTest();
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Slack test failed" }, { status: 400 });
  }
}
