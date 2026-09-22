import { requireUser } from "@/lib/auth";
import { composeContactDraft, rolesFromSignal } from "@/lib/contact-draft";
import { admin } from "@/lib/supabase/admin";
import { senderProfile } from "@/lib/sender";
import { z } from "zod";

const input = z.object({ personId: z.string().trim().min(1).max(64) });

/**
 * Write and save a draft aimed at ONE colleague at this company.
 *
 * No model call, so this costs nothing: the angle comes from what that person's role owns and every
 * concrete detail from the signal already on file. That matters because the alternative — regenerating
 * with AI — is the single largest way to spend money here.
 *
 * The draft is saved as that person's own card. cards has unique(signal_id, person_id), so the schema
 * already expects one card per person per signal; giving each contact their own means their draft, their
 * send, their follow-ups and their History are all separate, instead of several people sharing one row and
 * overwriting each other — which is what has gone wrong repeatedly.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { personId } = input.parse(await request.json());
    const db = admin();

    const { data: card } = await db.from("cards")
      .select("id,signal_id,account_id,person_id,score,brief,why_now,channel,assigned_to,signals(raw,summary),accounts(name,domain)")
      .eq("id", id).single();
    if (!card) throw new Error("Card not found");

    const { data: person } = await db.from("people").select("id,full_name,title,account_id").eq("id", personId).maybeSingle();
    if (!person) throw new Error("That contact is no longer on file.");
    if (person.account_id !== card.account_id) throw new Error("That contact works at a different company.");

    // Already has their own card? Then this is a rewrite of it, not a second one.
    const { data: existing } = await db.from("cards").select("id,status")
      .eq("signal_id", card.signal_id).eq("person_id", personId).maybeSingle();
    if (existing && !["new", "approved", "edited"].includes(existing.status as string)) {
      return Response.json({ error: `${person.full_name} has already been written to — their draft is kept as a record.` }, { status: 400 });
    }

    const account = card.accounts as unknown as { name: string; domain: string } | null;
    const raw = (card.signals as unknown as { raw?: Record<string, unknown> } | null)?.raw ?? {};
    // Roles come from whichever shape the signal recorded them in.

    const roles = rolesFromSignal(raw);

    // Where this person sits among the colleagues drafted off the same signal. It rotates the copy pools, so
    // writing to four people one at a time produces four different letters rather than four draws from the
    // same small pool — which is how a CEO and a President ended up with the same pitch word for word.
    const { data: siblings } = await db.from("cards").select("person_id").eq("signal_id", card.signal_id)
      .not("person_id", "is", null).order("created_at");
    const order = (siblings ?? []).map((row) => row.person_id as string);
    const position = order.indexOf(personId);

    const profile = await senderProfile(db, user.owner);
    const draft = composeContactDraft({
      variantSalt: position >= 0 ? position : order.length,
      company: account?.name ?? "",
      personName: person.full_name as string,
      personTitle: (person.title as string) ?? "",
      whyNow: card.why_now as string,
      operatingNeed: typeof raw.operating_need === "string" ? raw.operating_need : null,
      roles,
      senderName: profile.fromName,
      senderTitle: profile.title,
    });

    const row = {
      signal_id: card.signal_id,
      person_id: personId,
      account_id: card.account_id,
      score: card.score,
      brief: card.brief,
      why_now: card.why_now,
      channel: card.channel,
      assigned_to: card.assigned_to,
      email_subject: draft.subject,
      email_body: draft.body,
      status: "edited",
    };
    const { data: saved, error } = await db.from("cards").upsert(row, { onConflict: "signal_id,person_id" })
      .select("id").single();
    if (error) return Response.json({ error: error.message }, { status: 400 });

    return Response.json({ ok: true, cardId: saved?.id, person: person.full_name, subject: draft.subject, body: draft.body });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not write the draft" }, { status: 400 });
  }
}
