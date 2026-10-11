import { bulkSendable, sendableAddress } from "./bulk-sendable.ts";
import { LIST_DRAFT_HASH } from "./draft-scope.ts";
import { currentTemplates, type CurrentTemplates } from "./draft-templates.ts";
import { speakableCompany } from "./list-templates.ts";
import { isLikelyPersonName } from "./pipeline.ts";
import { sendDayStart } from "./send-guards.ts";
import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

type Person = { full_name: string; email: string | null; email_status: string | null; email_check: unknown; do_not_contact: boolean | null } | null;

/** A seat's unsent list emails, one per person, and how many of their addresses are confirmed. */
export async function seatSummary(owner: Owner) {
  const db = admin();
  const [{ data }, { count: sentToday }] = await Promise.all([
    db.from("cards").select("id,person_id,people(full_name,email,email_status,email_check,do_not_contact),signals!inner(hash)").eq("assigned_to", owner).like("signals.hash", LIST_DRAFT_HASH).in("status", ["new", "edited", "approved"]).not("email_body", "is", null).limit(2000),
    db.from("touches").select("id", { count: "exact", head: true }).eq("sent_by", owner).eq("channel", "email").not("gmail_thread_id", "is", null).gte("sent_at", sendDayStart().toISOString()),
  ]);
  const seen = new Set<string>();
  const people = ((data ?? []) as unknown as Array<{ person_id: string; people: Person }>)
    .filter((row) => row.people && !row.people.do_not_contact && isLikelyPersonName(row.people.full_name) && !seen.has(row.person_id) && Boolean(seen.add(row.person_id)))
    .map((row) => row.people as NonNullable<Person>);
  const confirmed = people.filter((person) => bulkSendable(person)).length;
  const sendable = people.filter((person) => sendableAddress(person)).length;
  return { unsent: people.length, confirmed, unconfirmed: sendable - confirmed, noAddress: people.length - sendable, sentToday: sentToday ?? 0 };
}

/** The greeting and subject most of a seat's unsent drafts share, as the Drafts page and Overview show them. */
export async function draftTemplates(owner: Owner): Promise<CurrentTemplates> {
  const { data } = await admin().from("cards").select("email_subject,email_body,accounts(name),people(full_name),signals!inner(hash)").eq("assigned_to", owner).like("signals.hash", LIST_DRAFT_HASH).in("status", ["new", "edited", "approved"]).not("email_body", "is", null).limit(500);
  return currentTemplates(((data ?? []) as unknown as Array<{ email_subject: string | null; email_body: string | null; accounts: { name: string | null } | null; people: { full_name: string | null } | null }>).map((row) => ({
    body: row.email_body, subject: row.email_subject,
    first: (row.people?.full_name ?? "").trim().split(/\s+/)[0] ?? "",
    company: row.accounts?.name ? speakableCompany(row.accounts.name) : "",
  })));
}
