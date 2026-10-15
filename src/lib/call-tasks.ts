import type { SupabaseClient } from "@supabase/supabase-js";
import { addressCheck } from "./address-history.ts";
import { newCallPlan, readCallPlan, type CallPlan, type PhoneEvidence } from "./call-plan.ts";
import type { Owner } from "./types.ts";

export type CallTask = { id: string; cardId: string; personId: string; owner: Owner; name: string; title: string; company: string; domain: string; email: string | null; emailBody: string; emailSubject: string; bounced: boolean; why: string; plan: CallPlan };
type Row = { id: string; card_id: string; person_id: string; owner: Owner; status: string; rules: unknown; people: { full_name: string; title: string; phone: string | null; email: string | null; do_not_contact: boolean } | null; cards: { status: string; why_now: string; email_subject: string | null; accounts: { name: string; domain: string; status: string } | null } | null };
type Touch = { card_id: string; person_id: string; sent_by: Owner; sent_at: string; body: string | null; reply_at: string | null; reply_classification: string | null; bounced_at: string | null };
export function buildCallTasks(rows: Row[], touches: Touch[]): CallTask[] {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    const p = row.people, card = row.cards, account = card?.accounts;
    if (!p || !card || !account || p.do_not_contact || ["client", "do_not_contact", "paused"].includes(account.status) || ["dismissed", "archived", "meeting"].includes(card.status)) return [];
    const history = touches.filter(t => t.person_id === row.person_id && t.sent_by === row.owner).sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    const first = history[0];
    if (!first || first.card_id !== row.card_id || history.some(t => t.bounced_at || (t.reply_at && !["ooo", "none"].includes(t.reply_classification ?? "neutral")))) return [];
    const key = `${row.owner}:${row.person_id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const plan = readCallPlan(addressCheck(row.rules).call) ?? newCallPlan(first.sent_at);
    plan.firstEmailAt = new Date(first.sent_at).toISOString();
    if (!plan.phone && p.phone) plan.phone = { number: p.phone, kind: "contact", sourceUrl: null, checkedAt: first.sent_at, notes: "Existing contact number. Source and direct-line status have not been recorded." };
    return [{ id: row.id, cardId: row.card_id, personId: row.person_id, owner: row.owner, name: p.full_name, title: p.title, company: account.name, domain: account.domain, email: p.email, emailBody: first.body ?? "", emailSubject: card.email_subject ?? "", bounced: Boolean(first.bounced_at), why: card.why_now, plan }];
  }).sort((a, b) => a.plan.scheduledAt.localeCompare(b.plan.scheduledAt));
}
export async function loadCallTasks(db: SupabaseClient, owner?: Owner): Promise<CallTask[]> {
  let query = db.from("cadences").select("id,card_id,person_id,owner,status,rules,people(full_name,title,phone,email,do_not_contact),cards(status,why_now,email_subject,accounts(name,domain,status))").in("status", ["active", "completed"]).order("created_at", { ascending: false }).limit(1000);
  if (owner) query = query.eq("owner", owner);
  const rows = await query;
  if (rows.error) throw new Error("Could not load call tasks.");
  const data = (rows.data ?? []) as unknown as Row[];
  const ids = [...new Set(data.map(row => row.person_id))];
  const touches: Touch[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const read = await db.from("touches").select("card_id,person_id,sent_by,sent_at,body,reply_at,reply_classification,bounced_at").in("person_id", ids.slice(i, i + 100)).eq("channel", "email").not("sent_at", "is", null).order("sent_at", { ascending: true }).limit(5000);
    if (read.error) throw new Error("Could not confirm first-email history for calls.");
    touches.push(...read.data as Touch[]);
  }
  const suppressed = await db.from("people").select("email").eq("do_not_contact", true).not("email", "is", null).limit(5000);
  if (suppressed.error) throw new Error("Could not confirm opt-outs for call tasks.");
  const optedOut = new Set((suppressed.data ?? []).map(person => String(person.email).trim().toLowerCase()));
  return buildCallTasks(data.filter(row => !row.people?.email || !optedOut.has(row.people.email.trim().toLowerCase())), touches);
}

/** Compare-and-swap preserves cadence rules and concurrently recorded call outcomes. */
export async function updateCallPlan(db: SupabaseClient, id: string, change: (plan: CallPlan | null) => CallPlan) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await db.from("cadences").select("rules,updated_at,status").eq("id", id).single();
    if (current.error) throw new Error("Could not read the call plan.");
    if (!["active", "completed"].includes(current.data.status)) throw new Error("This outreach sequence is stopped or paused.");
    const rules = addressCheck(current.data.rules);
    const plan = change(readCallPlan(rules.call));
    const saved = await db.from("cadences").update({ rules: { ...rules, call: plan } }).eq("id", id).eq("updated_at", current.data.updated_at).eq("status", current.data.status).select("id");
    if (saved.error) throw new Error("Could not save the call plan.");
    if (saved.data?.length) return plan;
  }
  throw new Error("This call changed while you were editing it. Reload and try again.");
}
export async function saveCallPhone(db: SupabaseClient, task: CallTask, phone: PhoneEvidence | null) {
  return updateCallPlan(db, task.id, current => ({ ...(current ?? task.plan), ...((current ?? task.plan).phone ? {} : { phone }), phoneSearchedAt: new Date().toISOString() }));
}
