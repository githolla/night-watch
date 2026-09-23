import { snapshotVersion } from "@/lib/version-tracking";
import { identifyVersion } from "@/lib/version-attribution";
import { savedVariants, renderSavedVariant } from "@/lib/outreach-variants";
import { senderProfile } from "@/lib/sender";
import { emailStyle } from "@/lib/email-style";
import { requireUser } from "@/lib/auth";import { admin } from "@/lib/supabase/admin";import { z } from "zod";
const update=z.object({saved_variant_id:z.enum(["a","b","c","d"]).optional(),status:z.enum(["new","approved","edited","snoozed","dismissed","sent","replied","positive","meeting","archived"]).optional(),email_subject:z.string().max(120).transform(emailStyle).optional(),email_body:z.string().max(1000).transform(emailStyle).optional(),linkedin_note:z.string().max(300).optional(),linkedin_comment:z.string().max(1000).optional(),linkedin_message:z.string().max(1500).optional(),linkedin_subject:z.string().max(120).optional(),assigned_to:z.enum(["josh","jenna"]).optional(),dismiss_reason:z.string().max(200).nullable().optional(),snooze_until:z.string().nullable().optional()});
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { saved_variant_id, ...body } = update.parse(await request.json());
    const db = admin();
    let selectedId: string | undefined;
    if (saved_variant_id) {
      const { data: card } = await db.from("cards").select("person_id,status,accounts(domain),people(full_name)").eq("id", id).single();
      if (!card || !["new", "approved", "edited"].includes(card.status)) throw new Error("This draft is no longer editable.");
      const domain = (card.accounts as unknown as { domain: string }).domain;
      const contactName = (card.people as unknown as { full_name: string }).full_name;
      const variant = savedVariants(domain, contactName).find(v => v.id === saved_variant_id);
      if (!variant) throw new Error("No saved version exists for this contact.");
      const sender = await senderProfile(db, user.owner);
      const rendered = renderSavedVariant(variant, contactName, sender.fromName, sender.greeting);
      body.email_subject = rendered.subject;
      body.email_body = rendered.body;
      const meta = identifyVersion({ domain, contactName, personId: card.person_id, subject: rendered.subject, body: rendered.body, senderName: sender.fromName, greeting: sender.greeting, source: "selection" });
      selectedId = await snapshotVersion(db, { cardId: id, personId: card.person_id, owner: user.owner, ...rendered, meta });
    }
    const editsCopy = ["email_subject", "email_body", "linkedin_note", "linkedin_comment", "linkedin_message", "linkedin_subject"].some(key => key in body);
    if (editsCopy && (!body.status || body.status === "new")) body.status = "edited";
    let query = db.from("cards").update({ ...body, ...(selectedId ? { active_variant_id: selectedId } : {}) }).eq("id", id);
    if (editsCopy) query = query.in("status", ["new", "approved", "edited"]);
    const { data, error } = await query.select().maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "This card changed or was sent. Reload before editing." }, { status: 409 });
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
