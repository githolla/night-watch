import type { SupabaseClient } from "@supabase/supabase-js";
import { sendCardEmail } from "./card-send.ts";
import { localParts } from "./local-time.ts";
import { LIST_OWNERS } from "./nightly-list-builder.ts";
import { configuredBaseUrl } from "./opt-out.ts";
import { sendDayStart } from "./send-guards.ts";
import { postSlackMessage } from "./slack.ts";
import type { ListRow } from "./research-data/server.ts";
import type { Owner } from "./types.ts";
import { autoSendBlocker, bounceBrake, MORNING, paceForRun } from "./morning-send-rules.ts";

export { autoSendBlocker, bounceBrake, MORNING, paceForRun };

const seatName = (owner: Owner) => (owner === "josh" ? "Josh" : "Suuchi");
const listLink = (owner: Owner) => `${configuredBaseUrl()}/outreach?list=${owner === "josh" ? "josh" : "suuchi"}&batch=today`;
const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;


type Db = SupabaseClient;

type Seat = { owner: Owner; autoSend: boolean; paused: boolean; postalAddress: string };
type ListState = { id: string; rows: ListRow[]; announced_at: string | null; summary_posted_at: string | null; sent_count: number; held_count: number };
type DeskCard = { id: string; status: string; email_subject: string | null; email_body: string | null; accounts: { domain: string } | null };

async function seat(db: Db, owner: Owner): Promise<Seat> {
  const { data } = await db.from("sender_profiles").select("*").eq("owner", owner).maybeSingle();
  return { owner, autoSend: Boolean(data?.auto_send), paused: Boolean(data?.auto_send_paused), postalAddress: ((data?.postal_address as string | null) ?? "").trim() };
}

async function todaysCards(db: Db, owner: Owner, rows: ListRow[]): Promise<DeskCard[]> {
  const domains = rows.map((row) => row.domain);
  if (!domains.length) return [];
  const { data } = await db.from("cards").select("id,status,email_subject,email_body,accounts!inner(domain),signals!inner(hash)").eq("assigned_to", owner).in("accounts.domain", domains).like("signals.hash", "operator-shortlist-20260923:%");
  const order = new Map(domains.map((domain, index) => [domain, index]));
  return ((data ?? []) as unknown as DeskCard[]).sort((a, b) => (order.get(a.accounts?.domain ?? "") ?? 99) - (order.get(b.accounts?.domain ?? "") ?? 99));
}

async function bounceCounts(db: Db, owner: Owner) {
  const since = sendDayStart().toISOString();
  const [{ count: sent }, { count: bounced, error }] = await Promise.all([
    db.from("touches").select("*", { count: "exact", head: true }).eq("sent_by", owner).eq("channel", "email").not("gmail_thread_id", "is", null).gte("sent_at", since),
    db.from("touches").select("*", { count: "exact", head: true }).eq("sent_by", owner).eq("channel", "email").not("bounced_at", "is", null).gte("sent_at", since),
  ]);
  return { sent: sent ?? 0, bounced: error ? 0 : bounced ?? 0 };
}

export type MorningSendResult = Array<{ owner: Owner; action: string; sent?: number; held?: number; reason?: string }>;

/**
 * The morning run, every ten minutes: announce the list at 7:00, send between 9:00 and 11:30 at an even pace,
 * summarise afterwards. Every email goes through sendCardEmail with automatic=true, so it takes the same
 * guards as a click and an address that is not confirmed deliverable is left for a person to send.
 */
export async function runMorningSend(db: Db, options: { now?: Date } = {}): Promise<MorningSendResult> {
  const now = options.now ?? new Date();
  const local = localParts(now);
  const out: MorningSendResult = [];
  for (const owner of LIST_OWNERS) {
    const { data: list } = await db.from("reachout_lists").select("id,rows,announced_at,summary_posted_at,sent_count,held_count").eq("list_date", local.date).eq("owner", owner).eq("status", "ready").maybeSingle();
    if (!list) { out.push({ owner, action: "no list" }); continue; }
    const state = list as unknown as ListState;
    const seatState = await seat(db, owner);
    const blocker = autoSendBlocker(seatState);
    const cards = await todaysCards(db, owner, state.rows ?? []);
    const unsent = cards.filter((card) => ["new", "edited", "approved"].includes(card.status) && card.email_subject?.trim() && card.email_body?.trim());

    if (local.minutes >= MORNING.announceAt && !state.announced_at) {
      const text = blocker
        ? `${state.rows.length} companies are ready for ${seatName(owner)} today. Nothing sends automatically (${blocker}). Review and send: ${listLink(owner)}`
        : `${state.rows.length} companies are ready for ${seatName(owner)}. Confirmed addresses start sending at ${clock(MORNING.sendFrom)}, spread until ${clock(MORNING.sendUntil)}. Remove or edit any before then: ${listLink(owner)}`;
      await postSlackMessage(text).catch(() => false);
      await db.from("reachout_lists").update({ announced_at: now.toISOString() }).eq("id", state.id);
    }
    if (blocker) { out.push({ owner, action: "skipped", reason: blocker }); continue; }

    if (local.minutes >= MORNING.sendUntil) {
      if (!state.summary_posted_at) {
        const held = unsent.length;
        await postSlackMessage(`${seatName(owner)}'s morning send is done: ${state.sent_count} sent automatically${held ? `, ${held} left on the list to review and send by hand (address not confirmed, or edited after the hold)` : ""}. ${listLink(owner)}`).catch(() => false);
        await db.from("reachout_lists").update({ summary_posted_at: now.toISOString(), held_count: held }).eq("id", state.id);
      }
      out.push({ owner, action: "window closed" });
      continue;
    }
    if (local.minutes < MORNING.sendFrom) { out.push({ owner, action: "waiting" }); continue; }

    const bounces = await bounceCounts(db, owner);
    if (bounceBrake(bounces.sent, bounces.bounced)) {
      const reason = `${bounces.bounced} of ${bounces.sent} emails bounced today (over ${Math.round(MORNING.bounceRate * 100)}%)`;
      await db.from("sender_profiles").update({ auto_send_paused: true, auto_send_paused_reason: reason }).eq("owner", owner);
      await postSlackMessage(`Auto-send paused for ${seatName(owner)}: ${reason}. Check the addresses, then turn it back on in Settings.`).catch(() => false);
      out.push({ owner, action: "paused", reason });
      continue;
    }

    const quota = paceForRun(unsent.length, local.minutes);
    let sent = 0, held = 0;
    for (const card of unsent) {
      if (sent >= quota) break;
      try {
        await sendCardEmail(db, { cardId: card.id, owner, subject: card.email_subject!, body: card.email_body!, baseUrl: configuredBaseUrl(), automatic: true });
        sent += 1;
      } catch (error) {
        // Not confirmed deliverable, already sent by hand, or the cap: leave it on the desk for a person.
        held += 1;
        console.warn(`[night-watch] auto-send held ${card.accounts?.domain} for ${owner}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (sent) await db.from("reachout_lists").update({ sent_count: state.sent_count + sent }).eq("id", state.id);
    out.push({ owner, action: "sent", sent, held });
  }
  return out;
}
