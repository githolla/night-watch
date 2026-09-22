import { requireUser } from "@/lib/auth";
import { composeContactDraft, rolesFromSignal } from "@/lib/contact-draft";
import { senderProfile } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

export const maxDuration = 300;

type CardRow = {
  id: string; signal_id: string; why_now: string | null; assigned_to: string;
  signals: { raw: Record<string, unknown> | null } | null;
  accounts: { name: string } | null;
  people: { full_name: string; title: string | null } | null;
};

/**
 * Put every un-sent draft through the SAME composer, so the whole list reads as one voice.
 *
 * The per-contact drafter only ever wrote colleagues: the contact a company arrived with kept whatever the
 * AI wrote for them months ago. Working down the list you got one email with a greeting doubled into the
 * first line, the next with no subject at all, the next composed — three companies, three different
 * letters, which is not a list anyone can trust.
 *
 * No model call, so the whole list costs nothing.
 *
 * Sent outreach is never touched: this reads only the open statuses, and a body already on its way to
 * somebody is a record, not a draft. Paged by offset over a frozen source set; the caller drains it.
 */
const OPEN = ["new", "approved", "edited"];
const PAGE = 40;

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const offset = Number.isFinite(Number(body?.offset)) ? Math.max(0, Math.floor(Number(body.offset))) : 0;
    // Freeze the source set at the start of the drain. Every row this writes stays in OPEN, so a moving
    // count would let the run keep finding its own output.
    const before = typeof body?.before === "string" && body.before ? body.before : new Date().toISOString();
    const db = admin();

    const { data, count, error } = await db.from("cards")
      // assigned_to is READ below to decide whose voice each draft is written in. It was missing here while
      // the row type declared it, so TypeScript was satisfied and every card arrived with it undefined.
      .select("id,signal_id,why_now,assigned_to,signals(raw),accounts(name),people(full_name,title)", { count: "exact" })
      .in("status", OPEN)
      .lt("created_at", before)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    // Never report a failed read as a finished run.
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const cards = (data ?? []) as unknown as CardRow[];

    // Per card's assigned seat, not whoever pressed the button: a draft introduces the person who will send
    // it, so rewriting Jenna's cards under Josh's identity would put the wrong name in her first line — and
    // mixing the two across one list is what made the sender appear in some emails and not others.
    const profiles = new Map<string, Awaited<ReturnType<typeof senderProfile>>>();
    for (const owner of new Set(cards.map((card) => card.assigned_to).filter(Boolean))) {
      profiles.set(owner, await senderProfile(db, owner as Owner));
    }
    // Position within the signal, so two colleagues drafted off one signal draw different copy. Worked out
    // per page from the whole signal's cards, not the page, or everyone on page two would start at nought.
    const signalIds = Array.from(new Set(cards.map((card) => card.signal_id).filter(Boolean)));
    const positions = new Map<string, number>();
    if (signalIds.length) {
      const { data: siblings } = await db.from("cards").select("id,signal_id").in("signal_id", signalIds).order("id", { ascending: true });
      const seen = new Map<string, number>();
      for (const row of siblings ?? []) {
        const signal = row.signal_id as string;
        const next = seen.get(signal) ?? 0;
        positions.set(row.id as string, next);
        seen.set(signal, next + 1);
      }
    }

    let written = 0;
    let skipped = 0;
    let failed = 0;

    for (const card of cards) {
      const person = card.people;
      const company = card.accounts?.name ?? "";
      // Nothing to write a draft from — including no seat, which would produce an email introducing
      // nobody. Leave whatever is there rather than replacing it with something worse.
      if (!person?.full_name || !company || !profiles.get(card.assigned_to)) { skipped += 1; continue; }
      const raw = card.signals?.raw ?? {};
      const draft = composeContactDraft({
        variantSalt: positions.get(card.id) ?? 0,
        company,
        personName: person.full_name,
        personTitle: person.title ?? "",
        whyNow: card.why_now,
        operatingNeed: typeof raw.operating_need === "string" ? raw.operating_need : null,
        roles: rolesFromSignal(raw),
        senderName: profiles.get(card.assigned_to)?.fromName ?? null,
        senderTitle: profiles.get(card.assigned_to)?.title ?? null,
        greeting: profiles.get(card.assigned_to)?.greeting ?? null,
        signoff: profiles.get(card.assigned_to)?.signoff ?? null,
        intro: profiles.get(card.assigned_to)?.intro ?? null,
      });
      // Bounded to the open statuses again at write time: the read and the write are seconds apart, and a
      // card sent in between must not have its record overwritten with a draft.
      const { error: writeError } = await db.from("cards")
        .update({ email_subject: draft.subject, email_body: draft.body })
        .eq("id", card.id).in("status", OPEN);
      if (writeError) failed += 1; else written += 1;
    }

    const total = count ?? cards.length;
    const next = offset + cards.length;
    return Response.json({ written, skipped, failed, total, next, done: cards.length === 0 || next >= total, before });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not rewrite the drafts" }, { status: 400 });
  }
}
