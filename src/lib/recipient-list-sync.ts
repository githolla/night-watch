import type { SupabaseClient } from "@supabase/supabase-js";
import { addressCheck } from "./address-history.ts";

const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
export function updatedRecipientRow(value: unknown, person: { full_name: string; email: string | null; email_source: string | null; email_check: unknown }) {
  const row = addressCheck(value);
  const buyer = addressCheck(row.buyer);
  const matches = (name: unknown) => typeof name === "string" && nameKey(name) === nameKey(person.full_name);
  const contacts = Array.isArray(row.contacts) ? row.contacts.map(addressCheck) : [];
  if (!matches(buyer.name) && !contacts.some(contact => matches(contact.name))) return value;
  const check = addressCheck(person.email_check);
  return { ...row, ...(matches(buyer.name) ? { buyer: { ...buyer, email: person.email } } : {}), contacts: contacts.map(contact => matches(contact.name) ? { ...contact, email: person.email, emailStatus: person.email_source === "published" ? "published_unverified" : person.email_source === "pattern" ? "inferred" : contact.emailStatus, emailSourceUrl: typeof check.evidenceUrl === "string" ? check.evidenceUrl : contact.emailSourceUrl } : contact), emailCheck: check, publicResearch: check.publicResearch };
}

/** Rebase changed list snapshots without overwriting concurrent list edits or another buyer. */
export async function syncRecipientLists(db: SupabaseClient, personId: string) {
  const personRead = await db.from("people").select("full_name,email,email_source,email_check,accounts(domain)").eq("id", personId).maybeSingle();
  if (personRead.error) throw new Error("Could not load the researched contact for list synchronization.");
  const person = personRead.data as unknown as { full_name: string; email: string | null; email_source: string | null; email_check: unknown; accounts: { domain: string } | null } | null;
  if (!person?.accounts?.domain) return 0;
  const lists = await db.from("reachout_lists").select("id").eq("status", "ready").order("list_date", { ascending: false }).limit(60);
  if (lists.error) throw new Error("Could not load company lists for address synchronization.");
  let changed = 0;
  for (const list of lists.data ?? []) for (let attempt = 0; attempt < 3; attempt++) {
    const current = await db.from("reachout_lists").select("rows,updated_at").eq("id", list.id).single();
    if (current.error) throw new Error("Could not reload the company list.");
    const rows: unknown[] = Array.isArray(current.data.rows) ? current.data.rows : [];
    let differs = false;
    const next = rows.map(value => { const row = addressCheck(value); if (row.domain !== person.accounts?.domain) return value; const updated = updatedRecipientRow(value, person); if (JSON.stringify(updated) !== JSON.stringify(value)) differs = true; return updated; });
    if (!differs) break;
    const saved = await db.from("reachout_lists").update({ rows: next }).eq("id", list.id).eq("updated_at", current.data.updated_at).select("id");
    if (saved.error) {
      if (attempt < 2 && /fetch failed|timeout|network/i.test(saved.error.message)) continue;
      throw new Error(`Could not save the researched address to company lists: ${saved.error.message}`);
    }
    if (saved.data?.length) { changed++; break; }
    if (attempt === 2) throw new Error("Company list changed during address synchronization; retry the update.");
  }
  return changed;
}
