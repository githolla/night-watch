import { refineDraft } from "@/lib/agents";
import { outreachQualityFailures } from "@/lib/outreach-quality";
import { isCuratedDomain } from "@/lib/curated-worklist";
import { accountBrief, briefContact } from "@/lib/dossier-data";
import { requireUser } from "@/lib/auth";
import { composeContactDraft, rolesFromSignal } from "@/lib/contact-draft";
import { isRealContact } from "@/lib/clean";
import { isLikelyPersonName } from "@/lib/pipeline";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";
import { senderProfile } from "@/lib/sender";
import { z } from "zod";

const input = z.object({ personId: z.string().trim().min(1).max(64) });

/**
 * Open ONE colleague at this company on their own card, writing them their own first-touch email if they do
 * not have one yet.
 *
 * No model call, so this costs nothing: the angle comes from what that person's role owns and every concrete
 * detail from the signal already on file. That matters because the alternative — regenerating with AI — is
 * the single largest way to spend money here.
 *
 * cards has unique(signal_id, person_id), so the schema already expects one card per person per signal.
 * Giving each contact their own means their draft, their send, their follow-ups and their History are all
 * separate, instead of several people sharing one row and overwriting each other — which is what has gone
 * wrong repeatedly. Before this, every colleague was shown the FIRST contact's note with the greeting
 * swapped, so eight people at one company had one email between them.
 *
 * This route NEVER rewrites a draft that exists. A person who already has a card gets that card back
 * untouched, whether it is a hand-edited draft or one already sent. Composing over it would quietly destroy
 * the operator's own words just because they clicked a name.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    let { personId } = input.parse(await request.json());
    const db = admin();

    const { data: card, error: cardError } = await db.from("cards")
      .select("id,signal_id,account_id,person_id,score,score_breakdown,brief,why_now,channel,assigned_to,signals(raw,summary),accounts(name,domain)")
      .eq("id", id).single();
    if (cardError || !card) throw new Error("Card not found");

    const domain = (card.accounts as unknown as { domain: string } | null)?.domain;
    const named = accountBrief(domain)?.contacts.find(contact => contact.contact_id === personId);
    if (named) {
      const fullName = `${named.first_name} ${named.last_name}`;
      let found = await db.from("people").select("id").eq("account_id", card.account_id).ilike("full_name", fullName).maybeSingle();
      if (found.error) throw found.error;
      if (!found.data) {
        const inserted = await db.from("people").insert({ account_id: card.account_id, full_name: fullName, first_name: named.first_name, last_name: named.last_name, title: named.title, level: "owner", email_status: "none" });
        if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
        found = await db.from("people").select("id").eq("account_id", card.account_id).ilike("full_name", fullName).single();
      }
      if (!found.data) throw new Error("Could not prepare this contact.");
      personId = found.data.id;
    }
    const { data: person, error: personError } = await db.from("people").select("id,full_name,title,email,account_id,do_not_contact").eq("id", personId).maybeSingle();
    if (personError) throw new Error(personError.message);
    if (!person) throw new Error("That contact is no longer on file.");
    if (person.do_not_contact) throw new Error("This contact is marked do not contact.");
    if (person.account_id !== card.account_id) throw new Error("That contact works at a different company.");
    // This route had no quality check at all, which is how "Discover Untapped Performance" — a call to
    // action off the company's own site — got a real draft opening "Hi Discover,". The bulk drafter has
    // applied these from the start; opening one contact by hand must apply the same rule.
    const row = { full_name: person.full_name as string, title: (person.title as string) ?? null, email: (person.email as string) ?? null };
    if (!isLikelyPersonName(row.full_name) || !isRealContact(row)) {
      // Take it off the list for good rather than only refusing this once.
      await db.from("people").update({ do_not_contact: true }).eq("id", personId);
      return Response.json({ notAPerson: true, error: `“${row.full_name}” is not a person — it is a phrase from the company's website. It has been taken off the contact list.` }, { status: 400 });
    }

    const selectedAccount = card.accounts as unknown as { domain: string } | null;
    if (isCuratedDomain(selectedAccount?.domain) && !briefContact(selectedAccount?.domain, person.full_name)) {
      return Response.json({ error: "This worklist is limited to the researched buyer for each selected company." }, { status: 400 });
    }

    // Already has their own card? Hand it back as it stands. Nothing below may run.
    const { data: existing } = await db.from("cards").select("id").eq("signal_id", card.signal_id).eq("person_id", personId).maybeSingle();
    if (existing) return Response.json({ ok: true, existing: true, card: await fullCard(db, existing.id as string) });

    // Where this person sits among the colleagues already drafted off this signal. It rotates the copy
    // pools, so working down a company's list one name at a time produces different letters rather than
    // repeated draws from the same small pool — which is how a CEO and a President ended up word for word
    // identical.
    const { data: siblings } = await db.from("cards").select("id").eq("signal_id", card.signal_id).not("person_id", "is", null);
    const position = siblings?.length ?? 0;

    const account = card.accounts as unknown as { name: string; domain: string } | null;
    const raw = (card.signals as unknown as { raw?: Record<string, unknown> } | null)?.raw ?? {};
    // The seat the CARD belongs to, not whoever pressed the button. Using the presser meant a list carried
    // two voices at once: cards written by a tool introduced whoever ran it, cards rewritten by the nightly
    // pass introduced their own seat, and a seat with no name set produced "I am with Nine-67." So the same
    // company had the sender named in some emails and not in others.
    const profile = await senderProfile(db, (card.assigned_to as Owner) ?? user.owner);
    let draft = composeContactDraft({
      variantSalt: position,
      company: account?.name ?? "",
      domain: account?.domain,
      personName: person.full_name as string,
      personTitle: (person.title as string) ?? "",
      whyNow: card.why_now as string,
      operatingNeed: typeof raw.operating_need === "string" ? raw.operating_need : null,
      roles: rolesFromSignal(raw),
      senderName: profile.fromName,
      senderTitle: profile.title,
      greeting: profile.greeting,
      signoff: profile.signoff,
      intro: profile.intro,
    });

    const brief = accountBrief(account?.domain);
    if (brief && outreachQualityFailures(draft.body, { reframe: brief.pain_hypothesis.reframe }, draft.subject).length) {
      const checked = await refineDraft({ channel: "email", company: account?.name ?? "", domain: account?.domain, person: person.full_name, title: person.title ?? "", whyNow: card.why_now, body: draft.body, subject: draft.subject, senderName: profile.fromName, greeting: profile.greeting, instruction: `Write for this contact's responsibilities. ${brief.email_guidance.contact_2_angle}` });
      draft = { body: checked.body, subject: checked.subject ?? draft.subject };
    }
    const newCard = {
      signal_id: card.signal_id,
      person_id: personId,
      account_id: card.account_id,
      score: card.score,
      // Without the source card's breakdown this inherits '{}', and the next research run rescores it from
      // recency alone — sinking it to the bottom of the worklist or archiving it outright.
      score_breakdown: card.score_breakdown ?? {},
      brief: card.brief,
      why_now: card.why_now,
      channel: card.channel,
      assigned_to: card.assigned_to,
      email_subject: draft.subject,
      email_body: draft.body,
      status: "new",
    };
    // ignoreDuplicates so a race can never take the DO UPDATE branch: the check above is a check, not a
    // guarantee, and nothing here may rewrite somebody else's draft.
    const { error } = await db.from("cards").upsert(newCard, { onConflict: "signal_id,person_id", ignoreDuplicates: true });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    const { data: saved } = await db.from("cards").select("id").eq("signal_id", card.signal_id).eq("person_id", personId).maybeSingle();
    if (!saved) return Response.json({ error: "The draft could not be saved." }, { status: 400 });
    return Response.json({ ok: true, existing: false, card: await fullCard(db, saved.id as string) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not write that draft" }, { status: 400 });
  }
}

/** The card in the shape the worklist loads, so the client can drop it straight into its list. */
async function fullCard(db: ReturnType<typeof admin>, cardId: string) {
  const { data } = await db.from("cards").select("*,accounts!inner(*),people(*),signals!inner(*)").eq("id", cardId).single();
  return data;
}
