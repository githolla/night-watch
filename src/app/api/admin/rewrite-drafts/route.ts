import { requireUser } from "@/lib/auth";
import { refineDraft } from "@/lib/agents";
import { admin } from "@/lib/supabase/admin";
import { spendTally } from "@/lib/spend";

export const maxDuration = 300;

type CardRow = {
  id: string; why_now: string | null; email_subject: string | null; email_body: string | null; assigned_to: string;
  people: { full_name: string; title: string | null } | null;
  accounts: { name: string } | null;
};

// Re-run every un-sent email draft through the founder-voice rewriter (Sonnet) so the whole worklist
// picks up the current drafting quality without waiting for each company's 14-day re-analysis. Batched
// and cursor-bounded by `before` (updated_at climbs past it as each card is rewritten) so repeated
// calls make progress and stop cleanly instead of rewriting the same cards.
export async function POST(request: Request) {
  const user = await requireUser();
  if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
  const db = admin();
  const { before } = await request.json().catch(() => ({ before: new Date().toISOString() }));
  const cutoff = typeof before === "string" && before ? before : new Date().toISOString();

  const { data: profiles } = await db.from("sender_profiles").select("owner,from_name,title");
  const prof = new Map<string, { name: string; title: string }>();
  for (const p of (profiles ?? []) as Array<{ owner: string; from_name: string | null; title: string | null }>)
    prof.set(p.owner, { name: p.from_name ?? "", title: p.title ?? "" });

  const filter = () => db.from("cards").select("id,why_now,email_subject,email_body,assigned_to,people(full_name,title),accounts(name)", { count: "exact" })
    .in("status", ["new", "approved", "edited"]).not("email_body", "is", null).lt("updated_at", cutoff);

  // Small batch, processed concurrently, so each request returns in seconds and the caller can show
  // progress and page through the worklist instead of one long silent call that looks hung.
  const { data } = await filter().order("updated_at", { ascending: true }).limit(10);
  const cards = (data ?? []) as unknown as CardRow[];
  // What this batch cost. Regenerating every draft is one press that fires one model call per draft, and
  // until now it recorded nothing at all — the single largest way to spend money invisibly.
  const tally = spendTally("rewrite_drafts");
  const results = await Promise.allSettled(cards.map(async (card) => {
    if (!card.email_body || !card.people?.full_name) { await db.from("cards").update({ updated_at: new Date().toISOString() }).eq("id", card.id); return false; }
    try {
      const sender = prof.get(card.assigned_to) ?? { name: "", title: "" };
      const out = await refineDraft({
        channel: "email", company: card.accounts?.name ?? "", person: card.people.full_name, title: card.people.title ?? "",
        whyNow: card.why_now ?? "", subject: card.email_subject ?? undefined, body: card.email_body,
        senderName: sender.name, senderTitle: sender.title,
      }, tally.record);
      await db.from("cards").update({ email_subject: out.subject ?? card.email_subject, email_body: out.body }).eq("id", card.id);
      return true;
    } catch {
      // Bump updated_at so a card that keeps failing drops past the cursor instead of wedging the batch.
      await db.from("cards").update({ updated_at: new Date().toISOString() }).eq("id", card.id);
      return false;
    }
  }));
  const rewritten = results.filter((r) => r.status === "fulfilled" && r.value).length;
  const costUsd = await tally.flush({ drafts: rewritten });
  const { count: remaining } = await filter().limit(1);
  return Response.json({ rewritten, remaining: remaining ?? 0, cutoff, costUsd: Number(costUsd.toFixed(4)) });
}
