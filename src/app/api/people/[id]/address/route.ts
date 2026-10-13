import { addressRejected, rejectedAddresses, replacementCheck } from "@/lib/address-history";
import { checkRecipient, recordRecipientCheck } from "@/lib/recipient-verification";
import { requireUser } from "@/lib/auth";
import { isRoleAddress } from "@/lib/clean";
import { reopenBouncedCards } from "@/lib/nightly-list-builder";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/** Save a replacement without discarding failed addresses; only mailbox verification reopens a bounce. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { email } = input.parse(await request.json());
    const db = admin();
    const { data: person } = await db.from("people").select("id,full_name,email,email_status,email_check,account_id,do_not_contact").eq("id", id).maybeSingle();
    if (!person) return Response.json({ error: "That contact is no longer on file." }, { status: 404 });
    if (user.role !== "admin") {
      const { count } = await db.from("cards").select("id", { count: "exact", head: true }).eq("person_id", id).eq("assigned_to", user.owner);
      if (!count) return Response.json({ error: "Only the person this contact is assigned to can change the address." }, { status: 403 });
    }
    if (person.do_not_contact) return Response.json({ error: `${person.full_name} asked not to be contacted.` }, { status: 400 });
    if (isRoleAddress(email)) return Response.json({ error: "That is a shared inbox, not a person's address." }, { status: 400 });
    const bounced = (person.email ?? "").toLowerCase() === email && (person.email_status === "invalid" || (person.email_check as { level?: string } | null)?.level === "undeliverable");
    if (bounced || rejectedAddresses(person).includes(email) || await addressRejected(db, email)) return Response.json({ error: `${email} already bounced. Enter a different address.` }, { status: 400 });
    const now = new Date().toISOString();
    const by = user.actor?.name ?? user.name;
    const { error } = await db.from("people").update({
      email, email_status: "unverified", email_source: "manual", email_verified_at: null,
      email_check: replacementCheck(person, { email, source: "manual", reason: `Entered by ${by}; mailbox verification pending.`, checkedAt: now }),
    }).eq("id", id);
    if (error) throw new Error(error.message);
    const candidate = { ...person, email, email_status: "unverified", email_source: "manual", email_check: replacementCheck(person, { email }) };
    const check = await checkRecipient(db, candidate, { id: person.account_id, domain: email.split("@")[1] }, { force: true });
    await recordRecipientCheck(db, candidate, check);
    if (check.level === "deliverable") await reopenBouncedCards(db, id);
    return Response.json({ email, verified: check.level === "deliverable", reason: check.reason });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "That is not a valid email address." : error instanceof Error ? error.message : "Could not save the address." }, { status: 400 });
  }
}
