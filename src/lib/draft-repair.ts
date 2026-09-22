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
 * Keep the stored drafts in step with the writer, and fix the ones that cannot be sent.
 *
 * TWO rules, because a draft can be wrong in two different ways.
 *
 * An UNTOUCHED draft (status "new") is recomposed every pass and saved if the writer would word it
 * differently now. Improving the writer does not change text already in the database, so a fault fixed in
 * the composer stayed on screen anyway: drafts were still reading "We put the financial reporting and the
 * reconciliation under it behind one scheduled job" hours after that phrasing was fixed, because nothing
 * ever went back over them. Catching it needed a new audit rule for every new fault, which is exactly the
 * trap of only ever checking for faults already seen. Comparing against what the writer produces TODAY
 * needs no rule at all.
 *
 * A draft somebody has WORKED ON (approved, or edited) is only rewritten when the audit says it cannot be
 * sent: a placeholder subject, a greeting for the wrong person, a role list read as a job title, a body
 * over the send limit. A nit — not naming the company, the first name used twice — leaves it alone,
 * because overwriting somebody's own wording over a nit is worse than the nit.
 *
 * Sent emails are never touched: they are a record of what went out.
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

  // Position within the signal, so two colleagues repaired in the same pass do not land on the same wording.
  // Worked out over EVERY row, not just the ones being rewritten, or a colleague repaired alone would take
  // position nought and collide with whoever already holds it.
  const positions = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const row of rows) {
    const next = seen.get(row.signal_id) ?? 0;
    positions.set(row.id, next);
    seen.set(row.signal_id, next + 1);
  }

  // Untouched drafts are kept current with the writer; worked-on ones only when they cannot be sent.
  const candidates = rows.filter((row) => row.status === "new" || !isSendable(auditDraft(toAuditRow(row))));
  if (!candidates.length) return { checked: rows.length, repaired: 0, failed: 0 };
  const broken = candidates;

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
    // Already exactly what the writer would produce: nothing to do, and writing anyway would touch every
    // untouched card on every pass.
    if (draft.subject === (row.email_subject ?? "") && draft.body === (row.email_body ?? "")) continue;
    // Bounded to the open statuses at write time too: the read and the write are seconds apart, and a card
    // sent in between must not have its record overwritten with a draft. Bounded to the status we READ as
    // well, so a card somebody edits mid-pass keeps their words rather than ours.
    const { error } = await db.from("cards")
      .update({ email_subject: draft.subject, email_body: draft.body })
      .eq("id", row.id).eq("status", row.status).in("status", open);
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
