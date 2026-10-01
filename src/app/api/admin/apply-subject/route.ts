import { adminGate } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 300;

/**
 * Blanket subject: set the same subject line on every un-sent email draft, leaving each body alone.
 *
 * This exists because editing one draft appeared to change them all — a scoping bug that was actually
 * overwriting other prospects' drafts. The operator liked the effect, so here it is as a deliberate,
 * explicit action instead of a side effect.
 *
 * Admin only: one click rewrites the subject of every un-sent draft on both seats, so it is not a member
 * action even though each draft can be edited one at a time. Batched and cursor-bounded by updated_at like the other bulk
 * tools, so a large list drains over several calls instead of timing out.
 */
export async function POST(request: Request) {
  const denied = await adminGate();
  if (denied) return denied;
  try {
    const { subject, before } = await request.json().catch(() => ({}));
    const line = typeof subject === "string" ? subject.trim() : "";
    if (!line) return Response.json({ error: "Write a subject first." }, { status: 400 });
    if (line.length > 120) return Response.json({ error: "That subject is too long (120 characters max)." }, { status: 400 });
    // "TEST" typed once and applied to all put the same placeholder on the subject of every un-sent email
    // on the list — sixty of them, found later one screenshot at a time. A blanket write is exactly where a
    // placeholder does the most damage, so it is refused here rather than caught afterwards.
    if (/^(test|testing|subject|draft|todo|tbd|xxx|asdf|n\/a|\.+)$/i.test(line)) {
      return Response.json({ error: `“${line}” looks like a placeholder. Applying it would put it on every un-sent email — write the subject you actually want to send.` }, { status: 400 });
    }
    const cutoff = typeof before === "string" && before ? before : new Date().toISOString();
    const db = admin();

    const filter = () => db.from("cards").select("id", { count: "exact" })
      .in("status", ["new", "approved", "edited"]).not("email_body", "is", null).lt("updated_at", cutoff);
    const { data } = await filter().order("updated_at", { ascending: true }).limit(50);
    const cards = (data ?? []) as Array<{ id: string }>;

    let applied = 0;
    await Promise.allSettled(cards.map(async (card) => {
      const { error } = await db.from("cards").update({ email_subject: line }).eq("id", card.id);
      if (!error) applied++;
    }));
    const { count: remaining } = await filter().limit(1);
    return Response.json({ applied, remaining: remaining ?? 0, cutoff });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not apply the subject" }, { status: 400 });
  }
}
