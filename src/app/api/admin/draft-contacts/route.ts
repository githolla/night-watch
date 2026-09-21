import { requireUser } from "@/lib/auth";
import { composeContactDraft } from "@/lib/contact-draft";
import { isRealContact } from "@/lib/clean";
import { senderProfile } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 300;

type CardRow = {
  id: string; signal_id: string; account_id: string; person_id: string; score: number;
  brief: string; why_now: string; channel: string; assigned_to: string;
  signals: { raw: Record<string, unknown> | null } | null;
  accounts: { name: string } | null;
};

type PersonRow = { id: string; full_name: string; title: string | null; level: string | null; email: string | null };

// Seniority order, so a cap of five takes the five people worth writing to, not five at random.
const LEVEL_RANK: Record<string, number> = { c_suite: 0, vp: 1, director: 2, head: 3, manager: 4, ic: 5, unknown: 6 };

/**
 * Write and save a draft for every contact worth emailing at each company, so the list is ready to work
 * rather than needing a button pressed per person.
 *
 * No model call, so the whole list costs nothing. Each draft is angled at what that person's role owns and
 * grounded in the company's own signal, and lands as that person's own card — their draft, their send,
 * their follow-ups, their History.
 *
 * Paged by offset over the source cards; the caller drains it. Nothing existing is overwritten: a contact
 * who already has a card for this signal is skipped, including the card's own contact.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const offset = Number.isFinite(Number(body?.offset)) ? Math.max(0, Math.floor(Number(body.offset))) : 0;
    // A cap per company, because a company can carry forty contacts and drafting all of them would bury
    // the desk in people nobody intends to write to.
    const perCompany = Math.max(1, Math.min(10, Math.floor(Number(body?.perCompany)) || 4));
    const PAGE = 15;
    const db = admin();

    const { data, count } = await db.from("cards")
      .select("id,signal_id,account_id,person_id,score,brief,why_now,channel,assigned_to,signals(raw),accounts(name)", { count: "exact" })
      .in("status", ["new", "approved", "edited"])
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    const cards = (data ?? []) as unknown as CardRow[];

    const profile = await senderProfile(db, user.owner);
    let written = 0;
    let skipped = 0;

    for (const card of cards) {
      const [{ data: people }, { data: siblings }] = await Promise.all([
        db.from("people").select("id,full_name,title,level,email")
          .eq("account_id", card.account_id).eq("do_not_contact", false).not("email", "is", null).limit(60),
        db.from("cards").select("person_id").eq("signal_id", card.signal_id),
      ]);
      // Never overwrite a draft that exists — including the card's own contact's.
      const taken = new Set<string>((siblings ?? []).map((row) => row.person_id as string));
      const candidates = ((people ?? []) as PersonRow[])
        .filter((person) => !taken.has(person.id))
        // A personal first-touch to recruiting@ reads as a bot and burns sending reputation on a mailbox
        // that never replies.
        .filter((person) => isRealContact(person))
        .sort((a, b) => (LEVEL_RANK[a.level ?? "unknown"] ?? 6) - (LEVEL_RANK[b.level ?? "unknown"] ?? 6))
        .slice(0, perCompany);
      if (!candidates.length) { skipped += 1; continue; }

      const raw = card.signals?.raw ?? {};
      const rawRoles = Array.isArray(raw.roles) ? raw.roles : Array.isArray(raw.open_roles) ? raw.open_roles : [];
      const roles = rawRoles.map((role) => typeof role === "string" ? role : (role as { title?: string })?.title ?? "").filter(Boolean).slice(0, 6);

      const rows = candidates.map((person) => {
        const draft = composeContactDraft({
          company: card.accounts?.name ?? "",
          personName: person.full_name,
          personTitle: person.title ?? "",
          whyNow: card.why_now,
          operatingNeed: typeof raw.operating_need === "string" ? raw.operating_need : null,
          roles,
          senderName: profile.fromName,
          senderTitle: profile.title,
        });
        return {
          signal_id: card.signal_id, person_id: person.id, account_id: card.account_id,
          score: card.score, brief: card.brief, why_now: card.why_now, channel: card.channel,
          assigned_to: card.assigned_to, email_subject: draft.subject, email_body: draft.body, status: "new",
        };
      });
      const { data: inserted, error } = await db.from("cards").upsert(rows, { onConflict: "signal_id,person_id" }).select("id");
      if (!error) written += inserted?.length ?? 0;
    }

    const nextOffset = offset + cards.length;
    const remaining = Math.max(0, (count ?? nextOffset) - nextOffset);
    return Response.json({ written, skipped, scanned: cards.length, offset: nextOffset, remaining, done: cards.length < PAGE || remaining === 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not write the drafts" }, { status: 400 });
  }
}
