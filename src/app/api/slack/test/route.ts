import { requireUser } from "@/lib/auth";
import { sendReplySlack, sendSlackTest } from "@/lib/slack";

export async function POST(request: Request) {
  try {
    await requireUser();
    const { kind } = await request.json().catch(() => ({}));
    // A sample of the exact reply card the replies cron posts, so the format can be verified in the channel
    // without waiting for a real prospect to reply.
    if (kind === "reply") {
      const result = await sendReplySlack({
        cardId: "sample",
        name: "Jordan Rivera",
        company: "Sample Manufacturing Co.",
        title: "VP of Operations",
        classification: "positive",
        body: "Thanks for reaching out — this is timely. We're actually looking at exactly this. Could you do a quick call next week?\n\nOn Tue, we wrote:\n> our outreach…",
        booked: false,
      });
      if (!result.delivered) return Response.json({ error: result.reason ?? "Slack is not configured" }, { status: 400 });
      return Response.json({ ok: true, result });
    }
    const result = await sendSlackTest();
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Slack test failed" }, { status: 400 });
  }
}
