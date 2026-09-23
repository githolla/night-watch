import { emailStyle } from "@/lib/email-style";
import { requireUser } from "@/lib/auth";import { admin } from "@/lib/supabase/admin";import { z } from "zod";
const update=z.object({status:z.enum(["new","approved","edited","snoozed","dismissed","sent","replied","positive","meeting","archived"]).optional(),email_subject:z.string().max(120).transform(emailStyle).optional(),email_body:z.string().max(1000).transform(emailStyle).optional(),linkedin_note:z.string().max(300).optional(),linkedin_comment:z.string().max(1000).optional(),linkedin_message:z.string().max(1500).optional(),linkedin_subject:z.string().max(120).optional(),assigned_to:z.enum(["josh","jenna"]).optional(),dismiss_reason:z.string().max(200).nullable().optional(),snooze_until:z.string().nullable().optional()});
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const body = update.parse(await request.json());
    const db = admin();
    const editsCopy = ["email_subject", "email_body", "linkedin_note", "linkedin_comment", "linkedin_message", "linkedin_subject"].some(key => key in body);
    if (editsCopy && (!body.status || body.status === "new")) body.status = "edited";
    let query = db.from("cards").update(body).eq("id", id);
    if (editsCopy) query = query.in("status", ["new", "approved", "edited"]);
    const { data, error } = await query.select().maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "This card changed or was sent. Reload before editing." }, { status: 409 });
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
