import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { authoredDraft } from "@/lib/authored-outreach";
import { angleFor, composeContactDraft } from "@/lib/contact-draft";
import { senderProfile } from "@/lib/sender";

/** An explicit user choice, unlike the automatic untouched-only refresh. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const db = admin();
    const { data: card, error } = await db.from("cards").select("id,person_id,status,email_subject,email_body,accounts(name,domain),people(full_name,title)").eq("id", id).single();
    if (error || !card) throw new Error("Card not found");
    if (!["new", "approved", "edited"].includes(card.status)) return Response.json({ error: "Sent or closed messages cannot be replaced." }, { status: 409 });
    const { count, error: touchError } = await db.from("touches").select("id", { count: "exact", head: true }).eq("card_id", id).eq("person_id", card.person_id);
    if (touchError) throw touchError;
    if (count) return Response.json({ error: "Outreach is already recorded for this contact. Keep its history and use a follow-up." }, { status: 409 });
    const account = card.accounts as unknown as { name: string; domain: string } | null;
    const person = card.people as unknown as { full_name: string; title: string } | null;
    if (!account || !person) throw new Error("The company or contact is missing.");
    const reviewed = authoredDraft(account.name, angleFor(person.title ?? ""), account.domain, person.full_name);
    if (!reviewed) return Response.json({ error: "There is no reviewed company draft for this buyer role yet." }, { status: 404 });
    const sender = await senderProfile(db, user.owner);
    const draft = composeContactDraft({ company: account.name, domain: account.domain, personName: person.full_name, personTitle: person.title ?? "", senderName: sender.fromName, senderTitle: sender.title, greeting: sender.greeting, signoff: sender.signoff, intro: sender.intro });
    const patch = { email_subject: draft.subject, email_body: draft.body, status: "edited", assigned_to: user.owner };
    let query = db.from("cards").update(patch).eq("id", id).eq("status", card.status);
    query = card.email_subject == null ? query.is("email_subject", null) : query.eq("email_subject", card.email_subject);
    query = card.email_body == null ? query.is("email_body", null) : query.eq("email_body", card.email_body);
    const { data: saved, error: saveError } = await query.select("id");
    if (saveError) throw saveError;
    if (!saved?.length) return Response.json({ error: "The draft changed while loading this version. Reload and try again." }, { status: 409 });
    return Response.json({ ...patch, audience: reviewed.targetRole });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load reviewed draft" }, { status: 400 });
  }
}
