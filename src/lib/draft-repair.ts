import { authoredDraft } from "./authored-outreach.ts";
import { shouldRefreshDraft } from "./draft-update-policy.ts";
import { auditDraft, isSendable, type AuditRow } from "./draft-audit.ts";
import { angleFor, composeContactDraft, rolesFromSignal } from "./contact-draft.ts";
import { senderProfile } from "./sender.ts";
import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

type Row = {
  id: string; person_id: string | null; status: string; signal_id: string; email_subject: string | null; email_body: string | null;
  why_now: string | null; assigned_to: Owner;
  signals: { raw: Record<string, unknown> | null } | null;
  accounts: { name: string; domain?: string } | null;
  people: { full_name: string; title: string | null; email: string | null } | null;
};

/** Refresh reviewed company copy without replacing hand edits, sent history, or good AI drafts outside the library. */
export async function repairBrokenDrafts(limit = 2000, budgetMs = 90_000, afterId?: string) {
  const deadline = Date.now() + budgetMs;
  const db = admin();
  const open = ["new", "approved", "edited"];
  const rows: Row[] = [];
  let readCursor = afterId;
  let exhausted = false;
  for (let from = 0; from < limit; from += 500) {
    let query = db.from("cards")
      .select("id,person_id,status,signal_id,email_subject,email_body,why_now,assigned_to,signals(raw),accounts(name,domain),people(full_name,title,email)")
      .in("status", open).order("id").limit(Math.min(500, limit - from));
    if (readCursor) query = query.gt("id", readCursor);
    const { data, error } = await query;
    // Never let a failed read look like a clean list.
    if (error) return { checked: 0, repaired: 0, failed: 0, done: false };
    rows.push(...((data ?? []) as unknown as Row[]));
    if ((data?.length ?? 0) < Math.min(500, limit - from)) { exhausted = true; break; }
    readCursor = data?.at(-1)?.id as string | undefined;
  }

  const ids = rows.map(row => row.id);
  const contacted = new Set<string>();
  if (ids.length) {
    const { data: touches, error } = await db.from("touches").select("card_id,person_id").in("card_id", ids);
    if (error) return { checked: 0, repaired: 0, failed: 1, done: false };
    for (const touch of touches ?? []) contacted.add(`${touch.card_id}:${touch.person_id}`);
  }
  const broken = rows.filter(row => shouldRefreshDraft(row.status,
    Boolean(authoredDraft(row.accounts?.name ?? "", angleFor(row.people?.title ?? ""), row.accounts?.domain, row.people?.full_name)),
    !isSendable(auditDraft(toAuditRow(row))), contacted.has(`${row.id}:${row.person_id}`)));
  if (!broken.length) return { checked: rows.length, repaired: 0, failed: 0, done: exhausted, nextCursor: rows.at(-1)?.id ?? afterId };

  // Each card's own seat: the draft introduces the sender by name, so repairing Jenna's card with Josh's
  // profile would put the wrong person's name in the first line of her email. Looked up once per seat.
  const profiles = new Map<string, Awaited<ReturnType<typeof senderProfile>> | null>();
  for (const owner of new Set(broken.map((row) => row.assigned_to))) {
    profiles.set(owner, await senderProfile(db, owner).catch(() => null));
  }

  const updates: Array<{ id: string; beforeSubject: string | null; beforeBody: string | null; subject: string; body: string }> = [];
  let repaired = 0;
  let failed = 0;
  let done = exhausted;
  let nextCursor = afterId;
  const candidateIds = new Set(broken.map(row => row.id));
  for (const row of rows) {
    // Out of time: leave the rest for the next pass rather than taking the whole refresh down with us.
    if (Date.now() > deadline) { done = false; break; }
    nextCursor = row.id;
    if (!candidateIds.has(row.id)) continue;
    const person = row.people;
    const company = row.accounts?.name ?? "";
    // Nothing to write from: leave it rather than replacing it with something worse.
    if (!person?.full_name || !company) continue;
    const raw = row.signals?.raw ?? {};
    const draft = composeContactDraft({
      variantSalt: row.people?.full_name ?? row.id,
      company,
      domain: row.accounts?.domain,
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
    let update = db.from("cards")
      .update({ email_subject: draft.subject, email_body: draft.body })
      .eq("id", row.id).eq("status", row.status).in("status", open);
    update = row.email_body === null ? update.is("email_body", null) : update.eq("email_body", row.email_body);
    update = row.email_subject === null ? update.is("email_subject", null) : update.eq("email_subject", row.email_subject);
    const { data: saved, error } = await update.select("id");
    if (error) failed += 1;
    else if (saved?.length) {
      repaired += 1;
      updates.push({ id: row.id, beforeSubject: row.email_subject, beforeBody: row.email_body, subject: draft.subject, body: draft.body });
    }
  }
  return { checked: rows.length, repaired, failed, done, updates, nextCursor };
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
