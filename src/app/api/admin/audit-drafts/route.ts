import { requireUser } from "@/lib/auth";
import { auditDraft, isSendable, type AuditRow } from "@/lib/draft-audit";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 300;

type CardRow = {
  id: string; status: string; email_subject: string | null; email_body: string | null;
  accounts: { name: string } | null;
  people: { full_name: string; title: string | null; email: string | null } | null;
};

/**
 * Check every draft on file against every rule, and say which ones are wrong and why.
 *
 * Read-only. Nothing is written, nothing is sent, and it costs nothing — no model call. It exists because
 * finding these one screenshot at a time is not an audit, and a count you have to take on trust is not
 * either: this returns the actual drafts, by contact and company, with the fault named in plain words.
 *
 * Paged by offset; the caller drains it and adds the pages up.
 */
const PAGE = 200;

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const offset = Number.isFinite(Number(body?.offset)) ? Math.max(0, Math.floor(Number(body.offset))) : 0;
    // Sent emails are a record of what went out, not a draft to be corrected — but they are still worth
    // counting, because a fault in one is a fault a prospect has already read.
    const scope = body?.scope === "all" ? "all" : "unsent";
    const db = admin();

    let query = db.from("cards")
      .select("id,status,email_subject,email_body,accounts(name),people(full_name,title,email)", { count: "exact" })
      .not("email_body", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (scope === "unsent") query = query.in("status", ["new", "approved", "edited"]);

    const { data, count, error } = await query;
    // Never report a failed read as a clean audit.
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const cards = (data ?? []) as unknown as CardRow[];

    const byRule: Record<string, number> = {};
    const problems: Array<{ id: string; who: string; company: string; status: string; subject: string; faults: Array<{ rule: string; says: string; blocking: boolean }> }> = [];
    let checked = 0;
    let clean = 0;
    let unsendable = 0;

    for (const card of cards) {
      const row: AuditRow = {
        id: card.id,
        status: card.status,
        subject: card.email_subject,
        body: card.email_body,
        personName: card.people?.full_name ?? null,
        personTitle: card.people?.title ?? null,
        personEmail: card.people?.email ?? null,
        company: card.accounts?.name ?? null,
      };
      checked += 1;
      const faults = auditDraft(row);
      if (!faults.length) { clean += 1; continue; }
      if (!isSendable(faults)) unsendable += 1;
      for (const fault of faults) byRule[fault.rule] = (byRule[fault.rule] ?? 0) + 1;
      // Cap what travels back per page; the counts above stay exact either way.
      if (problems.length < 60) {
        problems.push({
          id: card.id,
          who: row.personName ?? "Unknown contact",
          company: row.company ?? "Unknown company",
          status: card.status,
          subject: (card.email_subject ?? "").slice(0, 120),
          faults,
        });
      }
    }

    const total = count ?? cards.length;
    const next = offset + cards.length;
    return Response.json({ checked, clean, unsendable, byRule, problems, total, next, done: cards.length === 0 || next >= total });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not audit the drafts" }, { status: 400 });
  }
}
