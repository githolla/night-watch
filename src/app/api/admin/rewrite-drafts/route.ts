import { requireUser } from "@/lib/auth";
import { refineDraft } from "@/lib/agents";
import { admin } from "@/lib/supabase/admin";

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

  const { data } = await filter().order("updated_at", { ascending: true }).limit(25);
  const cards = (data ?? []) as unknown as CardRow[];
  let rewritten = 0;
  for (const card of cards) {
    if (!card.email_body || !card.people?.full_name) { await db.from("cards").update({ updated_at: new Date().toISOString() }).eq("id", card.id); continue; }
    try {
      const sender = prof.get(card.assigned_to) ?? { name: "", title: "" };
      const out = await refineDraft({
        channel: "email", company: card.accounts?.name ?? "", person: card.people.full_name, title: card.people.title ?? "",
        whyNow: card.why_now ?? "", subject: card.email_subject ?? undefined, body: card.email_body,
        senderName: sender.name, senderTitle: sender.title,
      });
      await db.from("cards").update({ email_subject: out.subject ?? card.email_subject, email_body: out.body }).eq("id", card.id);
      rewritten++;
    } catch {
      // Bump updated_at so a card that keeps failing doesn't wedge the batch on the next pass.
      await db.from("cards").update({ updated_at: new Date().toISOString() }).eq("id", card.id);
    }
  }
  const { count: remaining } = await filter().limit(1);
  return Response.json({ rewritten, remaining: remaining ?? 0, cutoff });
}
