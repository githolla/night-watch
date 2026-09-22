import { auditDraft, isSendable, type AuditRow } from "./draft-audit.ts";
import { composeContactDraft, rolesFromSignal } from "./contact-draft.ts";
import { senderProfile } from "./sender.ts";
import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

type Row = {
  id: string; status: string; signal_id: string; email_subject: string | null; email_body: string | null;
  why_now: string | null; assigned_to: Owner;
  signals: { raw: Record<string, unknown> | null } | null;
  accounts: { name: string } | null;
  people: { full_name: string; title: string | null; email: string | null } | null;
};

/**
 * Rewrite every un-sent draft that cannot be sent as it stands.
 *
 * The audit already knows what is broken and the writer already knows how to write a correct one; nothing
 * useful happens by keeping those two apart and waiting for somebody to notice. Sixty drafts sat on the
 * list carrying the subject "TEST" — one mis-aimed press of "apply to all" — and they stayed there until
 * they were found by hand, one screenshot at a time. This closes that loop on its own.
 *
 * Only BLOCKING faults trigger a rewrite: a subject that is a placeholder, a greeting for the wrong person,
 * a role list read as a job title, a body over the send limit. A nit — not naming the company, the first
 * name used twice — is left alone, because overwriting somebody's own wording over a nit is worse than the
 * nit. Sent emails are never touched: they are a record of what went out.
 */
export async function repairBrokenDrafts(limit = 2000) {
  const db = admin();
  const open = ["new", "approved", "edited"];
  const rows: Row[] = [];
  for (let from = 0; from < limit; from += 500) {
    const { data, error } = await db.from("cards")
      .select("id,status,signal_id,email_subject,email_body,why_now,assigned_to,signals(raw),accounts(name),people(full_name,title,email)")
      .in("status", open).not("email_body", "is", null).order("id").range(from, from + 499);
    // Never let a failed read look like a clean list.
    if (error) return { checked: 0, repaired: 0, failed: 0 };
    rows.push(...((data ?? []) as unknown as Row[]));
    if ((data?.length ?? 0) < 500) break;
  }

  const broken = rows.filter((row) => !isSendable(auditDraft(toAuditRow(row))));
  if (!broken.length) return { checked: rows.length, repaired: 0, failed: 0 };

  // Position within the signal, so two colleagues repaired in the same pass do not land on the same wording.
  const positions = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const row of rows) {
    const next = seen.get(row.signal_id) ?? 0;
    positions.set(row.id, next);
    seen.set(row.signal_id, next + 1);
  }

  // Each card's own seat: the draft introduces the sender by name, so repairing Jenna's card with Josh's
  // profile would put the wrong person's name in the first line of her email. Looked up once per seat.
  const profiles = new Map<string, Awaited<ReturnType<typeof senderProfile>> | null>();
  for (const owner of new Set(broken.map((row) => row.assigned_to))) {
    profiles.set(owner, await senderProfile(db, owner).catch(() => null));
  }

  let repaired = 0;
  let failed = 0;
  for (const row of broken) {
    const person = row.people;
    const company = row.accounts?.name ?? "";
    // Nothing to write from: leave it rather than replacing it with something worse.
    if (!person?.full_name || !company) continue;
    const raw = row.signals?.raw ?? {};
    const draft = composeContactDraft({
      variantSalt: positions.get(row.id) ?? 0,
      company,
      personName: person.full_name,
      personTitle: person.title ?? "",
      whyNow: row.why_now,
      operatingNeed: typeof raw.operating_need === "string" ? raw.operating_need : null,
      roles: rolesFromSignal(raw),
      senderName: profiles.get(row.assigned_to)?.fromName ?? null,
      senderTitle: profiles.get(row.assigned_to)?.title ?? null,
      greeting: profiles.get(row.assigned_to)?.greeting ?? null,
      signoff: profiles.get(row.assigned_to)?.signoff ?? null,
      intro: profiles.get(row.assigned_to)?.intro ?? null,
    });
    // Bounded to the open statuses at write time too: the read and the write are seconds apart, and a card
    // sent in between must not have its record overwritten with a draft.
    const { error } = await db.from("cards")
      .update({ email_subject: draft.subject, email_body: draft.body })
      .eq("id", row.id).in("status", open);
    if (error) failed += 1; else repaired += 1;
  }
  return { checked: rows.length, repaired, failed };
}

const toAuditRow = (row: Row): AuditRow => ({
  id: row.id,
  status: row.status,
  subject: row.email_subject,
  body: row.email_body,
  personName: row.people?.full_name ?? null,
  personTitle: row.people?.title ?? null,
  personEmail: row.people?.email ?? null,
  company: row.accounts?.name ?? null,
});
