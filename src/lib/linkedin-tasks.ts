import { buildLinkedInTasks, LINKEDIN_FIRST, LINKEDIN_TOUCHES, OPEN_DRAFT, type FirstMessageRow, type FollowupStepRow, type LinkedInDone, type LinkedInTask } from "./linkedin-task-list.ts";
import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

const DAY_MS = 86_400_000;

/** The seat's open LinkedIn sends, from LinkedIn-first drafts and due LinkedIn follow-ups. */
export async function loadLinkedInTasks(owner: Owner, now: Date = new Date()): Promise<LinkedInTask[]> {
  const db = admin();
  const [{ data: cards, error: cardError }, { data: steps, error: stepError }] = await Promise.all([
    db.from("cards").select("id,person_id,updated_at,channel,status,linkedin_subject,linkedin_message,people(full_name,title,linkedin_url,do_not_contact),accounts(name,domain)")
      .eq("assigned_to", owner).in("channel", LINKEDIN_FIRST).in("status", OPEN_DRAFT).not("linkedin_message", "is", null).limit(500),
    db.from("cadence_steps").select("id,step_number,channel,status,scheduled_at,sent_at,error,subject,body,cadences!inner(card_id,person_id,owner,status,people(full_name,title,linkedin_url,do_not_contact),cards(accounts(name,domain)))")
      .in("channel", LINKEDIN_TOUCHES).in("status", ["pending", "ready", "failed"]).eq("cadences.status", "active").eq("cadences.owner", owner)
      .lte("scheduled_at", now.toISOString()).order("scheduled_at", { ascending: true }).limit(500),
  ]);
  if (cardError || stepError) throw new Error("Could not load LinkedIn tasks. Reload to try again.");
  const cardRows = (cards ?? []) as unknown as FirstMessageRow[];
  const ids = cardRows.map((row) => row.id);
  const { data: touched } = ids.length
    ? await db.from("touches").select("card_id").in("card_id", ids).in("channel", LINKEDIN_TOUCHES)
    : { data: [] };
  const touchedIds = new Set(((touched ?? []) as Array<{ card_id: string }>).map((row) => row.card_id));
  return buildLinkedInTasks(cardRows, touchedIds, (steps ?? []) as unknown as FollowupStepRow[], now.getTime());
}

/** How many LinkedIn sends wait on this seat: the number for Overview and the sidebar. */
export async function linkedinTaskCount(owner: Owner, now: Date = new Date()): Promise<number> {
  return (await loadLinkedInTasks(owner, now)).length;
}

/** LinkedIn sends recorded from this seat in the last `days` days, newest first. */
export async function loadLinkedInDone(owner: Owner, now: Date = new Date(), days = 14): Promise<LinkedInDone[]> {
  const { data } = await admin().from("touches").select("id,channel,body,sent_at,people(full_name),cards(accounts(name))")
    .eq("sent_by", owner).in("channel", LINKEDIN_TOUCHES).gte("sent_at", new Date(now.getTime() - days * DAY_MS).toISOString())
    .order("sent_at", { ascending: false }).limit(100);
  type Row = { id: string; channel: string; body: string | null; sent_at: string; people: { full_name: string | null } | null; cards: { accounts: { name: string | null } | null } | null };
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id, channel: row.channel, name: row.people?.full_name ?? "Unknown contact", company: row.cards?.accounts?.name ?? "", message: row.body ?? "", sentAt: row.sent_at,
  }));
}
