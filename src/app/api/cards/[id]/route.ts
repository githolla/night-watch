import { restoreSelectedDraft } from "@/lib/restore-selected-draft";
import { batchOwner } from "@/lib/focus-data";
import { snapshotVersion } from "@/lib/version-tracking";
import { identifyVersion } from "@/lib/version-attribution";
import { savedVariants, renderSavedVariant, renderLinkedInVariant } from "@/lib/outreach-variants";
import { senderProfile } from "@/lib/sender";
import { emailStyle } from "@/lib/email-style";
import { requireUser } from "@/lib/auth";import { admin } from "@/lib/supabase/admin";import { z } from "zod";
const update=z.object({expected_updated_at:z.string().optional(),reopen:z.boolean().optional(),saved_variant_channel:z.enum(["email","linkedin"]).default("email"),saved_variant_id:z.enum(["trigger","gift","peer-proof","business-idea","proof","direct-offer","concrete-idea","delivery-experience"]).optional(),status:z.enum(["new","approved","edited","snoozed","dismissed","sent","replied","positive","meeting","archived"]).optional(),email_subject:z.string().max(120).transform(emailStyle).optional(),email_body:z.string().max(1000).transform(emailStyle).optional(),linkedin_note:z.string().max(300).optional(),linkedin_comment:z.string().max(1000).optional(),linkedin_message:z.string().max(1500).optional(),linkedin_subject:z.string().max(120).optional(),assigned_to:z.enum(["josh","jenna"]).optional(),dismiss_reason:z.string().max(200).nullable().optional(),snooze_until:z.string().nullable().optional()});
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { expected_updated_at, reopen, saved_variant_id, saved_variant_channel, ...body } = update.parse(await request.json());
    const db = admin();
    let writeVersion=expected_updated_at, restored=false;
    const restoredStatus = await restoreSelectedDraft(db, id, reopen === true, {expectedUpdatedAt:reopen?undefined:expected_updated_at,onRestored:(version)=>{writeVersion=version;restored=true;}});
    if (reopen) body.status = restoredStatus as typeof body.status;
    if (reopen) {
      const { data: recovered, error: readError } = await db.from("cards").select("email_body,email_subject,accounts(domain),people(full_name)").eq("id", id).single();
      if (readError) throw readError;
      if (recovered && !recovered.email_body?.trim()) {
        const domain = (recovered.accounts as unknown as { domain: string }).domain;
        const name = (recovered.people as unknown as { full_name: string }).full_name;
        const variant = savedVariants(domain, name)[0];
        if (variant) {
          const profile = await senderProfile(db, batchOwner(domain) ?? user.owner);
          const draft = renderSavedVariant(variant, name, profile.fromName, profile.greeting);
          body.email_body = draft.body;
          if (!recovered.email_subject?.trim()) body.email_subject = draft.subject;
        }
      }
    }
    let selectedId: string | undefined;
    const linkedinOnly = body.email_body === undefined && body.email_subject === undefined && (saved_variant_channel === "linkedin" || body.linkedin_message !== undefined || body.linkedin_subject !== undefined);
    const editableStatuses = linkedinOnly ? ["new", "approved", "edited", "sent"] : ["new", "approved", "edited"];
    if (linkedinOnly) delete body.status;
    if (saved_variant_id) {
      const { data: card } = await db.from("cards").select("person_id,status,accounts(domain),people(full_name)").eq("id", id).single();
      if (!card || !editableStatuses.includes(card.status)) throw new Error("This draft is no longer editable.");
      const domain = (card.accounts as unknown as { domain: string }).domain;
      const contactName = (card.people as unknown as { full_name: string }).full_name;
      const variant = savedVariants(domain, contactName, saved_variant_channel).find(v => v.id === saved_variant_id);
      if (!variant) throw new Error("No saved version exists for this contact.");
      const sender = await senderProfile(db, batchOwner(domain) ?? user.owner);
      const rendered = saved_variant_channel === "linkedin" ? renderLinkedInVariant(variant, sender.fromName) : renderSavedVariant(variant, contactName, sender.fromName, sender.greeting);
      if (saved_variant_channel === "linkedin") { body.linkedin_subject = rendered.subject; body.linkedin_message = rendered.body; }
      else { body.email_subject = rendered.subject; body.email_body = rendered.body; }
      const meta = identifyVersion({ domain, contactName, personId: card.person_id, subject: rendered.subject, body: rendered.body, senderName: sender.fromName, greeting: sender.greeting, source: "selection", channel: saved_variant_channel });
      selectedId = await snapshotVersion(db, { cardId: id, personId: card.person_id, owner: batchOwner(domain) ?? user.owner, ...rendered, meta });
    }
    const editsCopy = ["email_subject", "email_body", "linkedin_note", "linkedin_comment", "linkedin_message", "linkedin_subject"].some(key => key in body);
    if (editsCopy && !linkedinOnly && (!body.status || body.status === "new")) body.status = "edited";
    let query = db.from("cards").update({ ...body, ...(selectedId && saved_variant_channel === "email" ? { active_variant_id: selectedId } : {}) }).eq("id", id);
    if (writeVersion && (!reopen || restored)) query = query.eq("updated_at", writeVersion);
    if (editsCopy || reopen) query = query.in("status", editableStatuses);
    const { data, error } = await query.select().maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "This draft changed in another session or was sent. Your text is still on screen. Reload the saved draft before resolving your changes." }, { status: 409 });
    return Response.json({...data,restored});
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: error instanceof Error && error.message.startsWith("This draft changed") ? 409 : 400 });
  }
}

/** Fetch a saved copy for conflict review without replacing the user's local edits. */
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 try{await requireUser();const {id}=await context.params;
 const {data,error}=await admin().from('cards').select('id,status,updated_at,email_subject,email_body,linkedin_subject,linkedin_message').eq('id',id).single();
 if(error||!data)throw new Error('Could not load the saved draft.');
 return Response.json(data,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Could not load draft'},{status:400});}
}
