import type { AiFit } from "./ai-fit.ts";
import { bulkSendable, sendableAddress } from "./bulk-sendable.ts";
import { isCuratedDomain } from "./curated-worklist.ts";
import { LIST_DRAFT_HASH } from "./draft-scope.ts";
import { isLikelyPersonName } from "./pipeline.ts";
import { focusedAccount } from "./reachout-sort.ts";
import { loadSendPlan } from "./send-plan-loader.ts";
import { industryOf, sizeOf } from "./send-plan.ts";
import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

/** One draft in the review workspace: the email, the person, the research behind it and where it sits. */
export type WorkspaceDraft = {
  id: string; updatedAt: string; status: string; subject: string; body: string;
  name: string; title: string; company: string; domain: string; email: string | null; confirmed: boolean; sendable: boolean;
  /** Curated companies send the short form of the body and no opt-out line, exactly as card-send does. */
  curated: boolean;
  /** Keep for me: auto-send skips it. */
  held: boolean;
  industry: string; size: string; linkedin: string | null; linkedinUrl: string | null;
  fit: { score: number; summary: string; reasons: string[]; concerns: string[] } | null;
  trigger: string | null;
  sources: Array<{ label: string; url: string }>;
  history: { sent: number; last: string | null };
  /** Its place in the next auto-send run: a position in the window, or why it is held. */
  slot: { position: number; label: string } | null;
};
export type WorkspacePlan = { dayLabel: string; windowLabel: string; going: number; dailyCap: number; sentToday: number; autoSend: boolean; blocker: string | null };

type Row = {
  id: string; person_id: string; status: string; updated_at: string; email_subject: string | null; email_body: string | null; auto_send_hold: boolean | null; linkedin_message: string | null;
  accounts: { name: string | null; domain: string | null; vertical: string | null } | null;
  people: { full_name: string; title: string | null; email: string | null; email_status: string | null; email_check: unknown; do_not_contact: boolean | null; linkedin_url: string | null } | null;
};

const hostLabel = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** Every unsent list email for a seat, once per real person, with the research and send position each needs. */
export async function loadDraftWorkspace(owner: Owner): Promise<{ drafts: WorkspaceDraft[]; plan: WorkspacePlan | null }> {
  const db = admin();
  const [{ data }, plan] = await Promise.all([
    db.from("cards").select("id,person_id,status,updated_at,email_subject,email_body,auto_send_hold,linkedin_message,accounts(name,domain,vertical),people(full_name,title,email,email_status,email_source,email_check,do_not_contact,linkedin_url),signals!inner(hash)")
      .eq("assigned_to", owner).like("signals.hash", LIST_DRAFT_HASH).in("status", ["new", "edited", "approved"]).not("email_body", "is", null).order("updated_at", { ascending: false }).limit(500),
    loadSendPlan(db, owner).catch(() => null),
  ]);
  const seen = new Set<string>();
  const rows = ((data ?? []) as unknown as Row[]).filter((row) => row.people && !row.people.do_not_contact && isLikelyPersonName(row.people.full_name) && !seen.has(row.person_id) && Boolean(seen.add(row.person_id)));

  const personIds = rows.map((row) => row.person_id);
  const { data: touches } = personIds.length
    ? await db.from("touches").select("person_id,sent_at").in("person_id", personIds).not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(2000)
    : { data: [] };
  const history = new Map<string, { sent: number; last: string | null }>();
  for (const touch of (touches ?? []) as Array<{ person_id: string; sent_at: string }>) {
    const seenBefore = history.get(touch.person_id);
    history.set(touch.person_id, { sent: (seenBefore?.sent ?? 0) + 1, last: seenBefore?.last ?? touch.sent_at });
  }

  const drafts = rows.map((row): WorkspaceDraft => {
    const person = row.people!;
    const domain = row.accounts?.domain ?? "";
    const focused = focusedAccount(domain) as { sector?: string; revenue?: { usdMillions?: number | null; status?: string | null; employees?: number | null }; aiFit?: AiFit; trigger?: { fact?: string; url?: string } } | undefined;
    const fit = focused?.aiFit && !focused.aiFit.disqualified
      ? { score: focused.aiFit.score, summary: focused.aiFit.summary, reasons: focused.aiFit.reasons.slice(0, 3).map((reason) => reason.text), concerns: focused.aiFit.concerns.slice(0, 2) }
      : null;
    const urls = [
      ...(domain ? [`https://${domain}`] : []),
      ...(focused?.aiFit?.reasons ?? []).map((reason) => reason.url).filter((url): url is string => Boolean(url)),
      ...(focused?.trigger?.url ? [focused.trigger.url] : []),
    ];
    const slot = plan?.slots[row.id];
    return {
      id: row.id, updatedAt: row.updated_at, status: row.status, subject: row.email_subject ?? "", body: row.email_body ?? "",
      name: person.full_name, title: person.title ?? "", company: row.accounts?.name ?? domain, domain, email: person.email,
      confirmed: bulkSendable(person), sendable: sendableAddress(person), curated: isCuratedDomain(domain), held: Boolean(row.auto_send_hold),
      industry: industryOf(focused?.sector ?? row.accounts?.vertical, row.accounts?.name), size: sizeOf(focused?.revenue),
      linkedin: row.linkedin_message?.trim() || null, linkedinUrl: person.linkedin_url,
      fit, trigger: focused?.trigger?.fact ?? null,
      sources: [...new Set(urls)].slice(0, 4).map((url, index) => ({ label: index === 0 && domain ? "Company website" : hostLabel(url), url })),
      history: history.get(row.person_id) ?? { sent: 0, last: null },
      slot: slot ? { position: slot.position, label: slot.label } : null,
    };
  }).sort((a, b) => (a.slot?.position || 1e6) - (b.slot?.position || 1e6) || a.company.localeCompare(b.company));

  return {
    drafts,
    plan: plan ? { dayLabel: plan.dayLabel, windowLabel: plan.windowLabel, going: plan.going, dailyCap: plan.dailyCap, sentToday: plan.sentToday, autoSend: !plan.blocker, blocker: plan.blocker } : null,
  };
}
