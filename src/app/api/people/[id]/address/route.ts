import { requireUser } from "@/lib/auth";
import { isRoleAddress } from "@/lib/clean";
import { reopenBouncedCards } from "@/lib/nightly-list-builder";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/**
 * Set a person's address by hand: the person who knows it (from a call, a card, a reply) confirms it. It
 * counts as confirmed from then on. A shared inbox and an address that already bounced are refused, and a
 * person whose first email bounced goes back in the queue so the email goes again, to this address.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { email } = input.parse(await request.json());
    const db = admin();
    const { data: person } = await db.from("people").select("id,full_name,email,email_status,email_check,do_not_contact").eq("id", id).maybeSingle();
    if (!person) return Response.json({ error: "That contact is no longer on file." }, { status: 404 });
    if (user.role !== "admin") {
      const { count } = await db.from("cards").select("id", { count: "exact", head: true }).eq("person_id", id).eq("assigned_to", user.owner);
      if (!count) return Response.json({ error: "Only the person this contact is assigned to can change the address." }, { status: 403 });
    }
    if (person.do_not_contact) return Response.json({ error: `${person.full_name} asked not to be contacted.` }, { status: 400 });
    if (isRoleAddress(email)) return Response.json({ error: "That is a shared inbox, not a person's address." }, { status: 400 });
    const bounced = (person.email ?? "").toLowerCase() === email && (person.email_status === "invalid" || (person.email_check as { level?: string } | null)?.level === "undeliverable");
    if (bounced) return Response.json({ error: `${email} already bounced. Enter a different address.` }, { status: 400 });
    const now = new Date().toISOString();
    const by = user.actor?.name ?? user.name;
    const { error } = await db.from("people").update({
      email, email_status: "verified", email_source: "manual", email_verified_at: now,
      email_check: { email, level: "deliverable", status: "verified", source: "manual", reason: `Entered by ${by}.`, checkedAt: now },
    }).eq("id", id);
    if (error) throw new Error(error.message);
    await reopenBouncedCards(db, id);
    return Response.json({ email });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "That is not a valid email address." : error instanceof Error ? error.message : "Could not save the address." }, { status: 400 });
  }
}
