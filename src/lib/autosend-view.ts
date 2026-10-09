import { bulkSendable, sendableAddress } from "./bulk-sendable.ts";
import { LIST_DRAFT_HASH } from "./draft-scope.ts";
import { allFocus } from "./focus-data.ts";
import { localParts } from "./local-time.ts";
import { loadSendPlan } from "./send-plan-loader.ts";
import { industryOf, roleOf, sizeOf, type SendPlan } from "./send-plan.ts";
import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

/** One email in the auto-send view: who, what kind of company, and where it sits in the queue. */
export type AutoSendEmail = {
  id: string; name: string; title: string; company: string; subject: string;
  industry: string; role: string; size: string; confirmed: boolean;
  /** going: in the next window; later: over the limit; held: the run skips it; kept: Keep for me. */
  group: "going" | "later" | "held" | "kept";
  position: number; time: string | null; reason: string | null;
};
export type AutoSendSummary = Omit<SendPlan, "slots">;
/** The seat's switch, as stored: what the on/off control on the page shows. */
export type AutoSendControl = { autoSend: boolean; paused: boolean; pausedReason: string | null; postalAddressSet: boolean; skippedToday: boolean };

/** The morning auto-send's next run for one seat, with the people and companies behind each queued email. */
export async function loadAutoSendView(owner: Owner): Promise<{ plan: AutoSendSummary; emails: AutoSendEmail[]; control: AutoSendControl }> {
  const db = admin();
  const [{ slots, ...plan }, { data: profile }] = await Promise.all([loadSendPlan(db, owner), db.from("sender_profiles").select("*").eq("owner", owner).maybeSingle()]);
  const control: AutoSendControl = {
    autoSend: Boolean(profile?.auto_send), paused: Boolean(profile?.auto_send_paused),
    pausedReason: (profile?.auto_send_paused_reason as string | null | undefined) ?? null,
    postalAddressSet: Boolean(((profile?.postal_address as string | null | undefined) ?? "").trim()),
    skippedToday: ((profile?.auto_send_skip_on as string | null | undefined) ?? null) === localParts().date,
  };
  const queued = Object.keys(slots);
  const select = "id,email_subject,auto_send_hold,accounts(name,domain,vertical),people(full_name,title,email,email_status,email_check)";
  const [{ data: inQueue }, { data: kept }] = await Promise.all([
    queued.length ? db.from("cards").select(select).in("id", queued) : Promise.resolve({ data: [] }),
    db.from("cards").select(`${select},signals!inner(hash)`).eq("assigned_to", owner).eq("auto_send_hold", true).like("signals.hash", LIST_DRAFT_HASH).in("status", ["new", "edited", "approved"]).limit(200),
  ]);
  type Row = { id: string; email_subject: string | null; auto_send_hold: boolean | null; accounts: { name: string | null; domain: string | null; vertical: string | null } | null; people: { full_name: string; title: string | null; email: string | null; email_status: string | null; email_check: unknown } | null };
  const listRows = new Map(allFocus().map((row) => [row.domain.toLowerCase(), row]));
  const toEmail = (row: Row): AutoSendEmail => {
    const listRow = row.accounts?.domain ? listRows.get(row.accounts.domain.toLowerCase()) : undefined;
    const slot = slots[row.id];
    const held = slot?.label.startsWith("Held: ");
    const group: AutoSendEmail["group"] = row.auto_send_hold ? "kept" : !slot || held ? "held" : slot.position <= plan.going ? "going" : "later";
    return {
      id: row.id, name: row.people?.full_name ?? "", title: row.people?.title ?? "", company: row.accounts?.name ?? row.accounts?.domain ?? "",
      subject: row.email_subject ?? "",
      industry: industryOf(listRow?.sector ?? row.accounts?.vertical, row.accounts?.name), role: roleOf(row.people?.title), size: sizeOf(listRow?.revenue),
      confirmed: Boolean(row.people && bulkSendable(row.people)) && Boolean(row.people && sendableAddress(row.people)),
      group, position: slot?.position ?? 0,
      time: group === "going" ? slot.label.match(/about (.+)$/)?.[1] ?? null : null,
      reason: held ? slot.label.slice(6) : null,
    };
  };
  const seen = new Set<string>();
  const emails = [...((inQueue ?? []) as unknown as Row[]), ...((kept ?? []) as unknown as Row[])]
    .filter((row) => !seen.has(row.id) && Boolean(seen.add(row.id)))
    .map(toEmail)
    .sort((a, b) => (a.position || 1e6) - (b.position || 1e6) || a.company.localeCompare(b.company));
  return { plan, emails, control };
}
