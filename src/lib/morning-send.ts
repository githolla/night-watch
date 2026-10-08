import type { SupabaseClient } from "@supabase/supabase-js";
import { sendCardEmail } from "./card-send.ts";
import { localParts } from "./local-time.ts";
import { LIST_OWNERS, nightlyListConfig } from "./nightly-list-builder.ts";
import { configuredBaseUrl } from "./opt-out.ts";
import { postSlackMessage } from "./slack.ts";
import { bulkSendable } from "./bulk-sendable.ts";
import type { ListRow } from "./research-data/server.ts";
import type { Owner } from "./types.ts";
import {
  announceText, autoSendBlocker, bounceBrake, bounceReason, identityHoldReason, isSendDay, listAlertText, MORNING, morningWindowProblems, paceForRun, pauseText, rowForecast, summaryText, type HeldCard,
} from "./morning-send-rules.ts";

export { autoSendBlocker, bounceBrake, isSendDay, MORNING, paceForRun };

const seatName = (owner: Owner) => (owner === "josh" ? "Josh" : "Suuchi");
const listLink = (owner: Owner) => `${configuredBaseUrl()}/outreach?list=${owner === "josh" ? "josh" : "suuchi"}&batch=today`;
const settingsLink = () => `${configuredBaseUrl()}/settings`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Db = SupabaseClient;

type Seat = { owner: Owner; autoSend: boolean; paused: boolean; postalAddress: string; skipOn: string | null; resumedAt: string | null };
type ListState = { id: string; status: string; rows: ListRow[]; errors: unknown[]; announced_at: string | null; summary_posted_at: string | null; sent_count: number; held_count: number };
type DeskCard = {
  id: string; status: string; email_subject: string | null; email_body: string | null; auto_send_hold?: boolean | null; auto_send_hold_reason?: string | null;
  accounts: { domain: string; name?: string | null; status?: string | null } | null;
  people?: { email?: string | null; email_status?: string | null; email_check?: unknown; do_not_contact?: boolean | null } | null;
};

/** Everything the run touches outside the database, injectable so tests can drive it. */
export type MorningOptions = {
  now?: Date;
  postSlackMessage?: (text: string) => Promise<unknown>;
  sendCardEmail?: (db: Db, input: Parameters<typeof sendCardEmail>[1]) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Milliseconds since some fixed point; the run stops starting sends MORNING.runBudgetMs after its first reading. */
  clock?: () => number;
  /** Close out any list still building for the date, and prepare cards for rows that have none. */
  finalizeOpenLists?: (db: Db, listDate: string) => Promise<unknown>;
  preparePendingRows?: (db: Db, listDate: string) => Promise<unknown>;
};

async function seat(db: Db, owner: Owner): Promise<Seat> {
  const { data } = await db.from("sender_profiles").select("*").eq("owner", owner).maybeSingle();
  return {
    owner, autoSend: Boolean(data?.auto_send), paused: Boolean(data?.auto_send_paused), postalAddress: ((data?.postal_address as string | null) ?? "").trim(),
    skipOn: (data?.auto_send_skip_on as string | null | undefined) ?? null, resumedAt: (data?.auto_send_resumed_at as string | null | undefined) ?? null,
  };
}

async function todaysCards(db: Db, owner: Owner, rows: ListRow[]): Promise<DeskCard[]> {
  const domains = rows.map((row) => row.domain);
  if (!domains.length) return [];
  const query = (columns: string) => db.from("cards").select(`${columns},accounts!inner(domain,name),signals!inner(hash),people(email_check)`).eq("assigned_to", owner).in("accounts.domain", domains).like("signals.hash", "operator-shortlist-20260923:%");
  let { data, error } = await query("id,status,email_subject,email_body,auto_send_hold,auto_send_hold_reason");
  // Before migration 0030 the hold columns are missing; read without them so the morning still runs.
  if (error) ({ data, error } = await query("id,status,email_subject,email_body"));
  const order = new Map(domains.map((domain, index) => [domain, index]));
  return ((data ?? []) as unknown as DeskCard[]).sort((a, b) => (order.get(a.accounts?.domain ?? "") ?? 99) - (order.get(b.accounts?.domain ?? "") ?? 99));
}

/**
 * Unsent list drafts outside today's list whose address passes the desk's Send all ready rule, so the First 25
 * and earlier lists keep going out without the tab open. A card held before (its hold reason set) waits for a
 * person rather than being retried every run.
 */
async function leftoverCards(db: Db, owner: Owner, todays: Set<string>): Promise<DeskCard[]> {
  const query = (columns: string) => db.from("cards").select(`${columns},accounts!inner(domain,name,status),signals!inner(hash),people(email,email_status,email_check,do_not_contact)`)
    .eq("assigned_to", owner).in("status", ["new", "edited", "approved"]).like("signals.hash", "operator-shortlist-20260923:%").limit(500);
  let { data, error } = await query("id,status,email_subject,email_body,auto_send_hold,auto_send_hold_reason");
  if (error) ({ data, error } = await query("id,status,email_subject,email_body"));
  if (error) return [];
  return ((data ?? []) as unknown as DeskCard[]).filter((card) =>
    !todays.has(card.accounts?.domain ?? "") && card.accounts?.status === "active" && !card.auto_send_hold && !card.auto_send_hold_reason &&
    Boolean(card.people && !card.people.do_not_contact && bulkSendable(card.people)) && Boolean(card.email_subject?.trim() && card.email_body?.trim()));
}

const CAP_REACHED = /Daily sender cap of \d+ reached/;

type BounceCounts = { sent: number; bounced: number; bouncedRecently: number; addresses: Array<{ email: string; company: string }> };
type TouchRow = { gmail_thread_id: string; sent_at: string; bounced_at: string | null; people?: { email?: string | null } | null; cards?: { accounts?: { name?: string | null; domain?: string | null } | null } | null };

/**
 * First emails (no earlier touch on the same thread) this seat sent in the last 7 days, or since it was
 * last resumed if later, and how many of them bounced, overall and in the last 48 hours. Null when the
 * history cannot be read, so the run sends nothing rather than sending blind.
 */
async function bounceCounts(db: Db, owner: Owner, now: Date, resumedAt: string | null): Promise<BounceCounts | null> {
  const weekAgo = now.getTime() - MORNING.bounceWindowDays * 86_400_000;
  const resumed = resumedAt ? Date.parse(resumedAt) : NaN;
  const since = new Date(Number.isFinite(resumed) ? Math.max(weekAgo, resumed) : weekAgo).toISOString();
  const { data, error } = await db.from("touches").select("gmail_thread_id,sent_at,bounced_at,people(email),cards(accounts(name,domain))").eq("sent_by", owner).eq("channel", "email").not("gmail_thread_id", "is", null).gte("sent_at", since).order("sent_at", { ascending: true }).limit(1000);
  if (error) return null;
  const firstByThread = new Map<string, TouchRow>();
  for (const touch of (data ?? []) as unknown as TouchRow[]) if (!firstByThread.has(touch.gmail_thread_id)) firstByThread.set(touch.gmail_thread_id, touch);
  if (firstByThread.size) {
    const { data: earlier, error: earlierError } = await db.from("touches").select("gmail_thread_id").eq("sent_by", owner).eq("channel", "email").in("gmail_thread_id", [...firstByThread.keys()]).lt("sent_at", since);
    if (earlierError) return null;
    for (const touch of (earlier ?? []) as Array<{ gmail_thread_id: string }>) firstByThread.delete(touch.gmail_thread_id);
  }
  const firsts = [...firstByThread.values()];
  const bounced = firsts.filter((touch) => touch.bounced_at);
  const recentSince = now.getTime() - MORNING.recentBounceHours * 3_600_000;
  const recent = bounced.filter((touch) => Date.parse(touch.bounced_at!) >= recentSince);
  const addresses = [...recent, ...bounced.filter((touch) => !recent.includes(touch))].map((touch) => ({ email: touch.people?.email ?? "unknown address", company: touch.cards?.accounts?.name ?? touch.cards?.accounts?.domain ?? "" }));
  return { sent: firsts.length, bounced: bounced.length, bouncedRecently: recent.length, addresses };
}

/** Atomic through the 0030 RPC; a read-and-add fallback before that migration is applied. */
export async function addSentCount(db: Db, listId: string, amount: number) {
  if (!amount) return;
  const { error } = await db.rpc("increment_list_sent", { list_id: listId, amount });
  if (!error) return;
  const { data } = await db.from("reachout_lists").select("sent_count").eq("id", listId).maybeSingle();
  await db.from("reachout_lists").update({ sent_count: Number(data?.sent_count ?? 0) + amount }).eq("id", listId);
}

/** Claim a once-a-day message by stamping its column only while it is still empty. True for the one run that wins. */
async function claim(db: Db, listId: string, column: "announced_at" | "summary_posted_at", now: Date, extra: Record<string, unknown> = {}) {
  const { data, error } = await db.from("reachout_lists").update({ [column]: now.toISOString(), ...extra }).eq("id", listId).is(column, null).select("id");
  return !error && Array.isArray(data) && data.length > 0;
}

/** Post a claimed message. Only a thrown error releases the claim for a later run; false means Slack is not set up. */
async function postClaimed(db: Db, listId: string, column: "announced_at" | "summary_posted_at", post: (text: string) => Promise<unknown>, text: string) {
  try {
    await post(text);
  } catch (error) {
    console.warn(`[night-watch] morning message failed, will retry: ${message(error)}`);
    await db.from("reachout_lists").update({ [column]: null }).eq("id", listId);
  }
}

function topErrors(errors: unknown[]) {
  const counts = new Map<string, number>();
  for (const item of errors ?? []) {
    const reason = item && typeof item === "object" && "reason" in item ? String((item as { reason: unknown }).reason) : typeof item === "string" ? item : "";
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => (count > 1 ? `${reason} (${count})` : reason));
}

function addressProblem(card: DeskCard) {
  const check = card.people?.email_check;
  if (!check || typeof check !== "object") return null;
  const { level, reason } = check as { level?: unknown; reason?: unknown };
  return level && level !== "deliverable" && typeof reason === "string" && reason ? reason : null;
}

async function holdCard(db: Db, card: DeskCard, reason: string) {
  // Before migration 0030 the column is missing and the write is simply refused.
  await db.from("cards").update({ auto_send_hold_reason: reason.slice(0, 500) }).eq("id", card.id);
  card.auto_send_hold_reason = reason;
}

export type MorningSendResult = Array<{ owner: Owner; action: string; sent?: number; held?: number; reason?: string }>;

/**
 * The morning run, every ten minutes on send days: close out a list the night left building, announce the
 * list at 7:00 (or say there is none), send between 9:00 and 11:30 at an even, capped pace with a random
 * wait before each email, then name every card left unsent. Every email goes through sendCardEmail with
 * automatic=true, so it takes the same guards as a click and an address that is not confirmed deliverable
 * (or confirmed by research, the Send all ready rule) is left for a person to send. After today's list it
 * sends confirmed drafts left from earlier lists, list or no list, until the seat's daily cap.
 */
export async function runMorningSend(db: Db, options: MorningOptions = {}): Promise<MorningSendResult> {
  const now = options.now ?? new Date();
  const post = options.postSlackMessage ?? ((text: string) => postSlackMessage(text));
  const send = options.sendCardEmail ?? sendCardEmail;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const clock = options.clock ?? Date.now;
  const started = clock();
  const local = localParts(now);
  if (!isSendDay(local.weekday, local.date)) return LIST_OWNERS.map((owner) => ({ owner, action: "not a send day" }));

  for (const step of [options.finalizeOpenLists, options.preparePendingRows]) {
    if (!step) continue;
    try { await step(db, local.date); } catch (error) { console.error(`[night-watch] morning list close-out failed: ${message(error)}`); }
  }
  const size = nightlyListConfig().size;
  const windowProblems = morningWindowProblems(process.env.SEND_TIMEZONE ?? "America/New_York", MORNING.announceAt, MORNING.sendFrom, MORNING.sendUntil, now);
  const out: MorningSendResult = [];
  let budgetSpent = false;

  for (const owner of LIST_OWNERS) {
    const read = () => db.from("reachout_lists").select("id,status,rows,errors,announced_at,summary_posted_at,sent_count,held_count").eq("list_date", local.date).eq("owner", owner).maybeSingle();
    let { data: list } = await read();
    let missing = false;
    // Without the Anthropic key the nightly build is switched off, so a day with no list is expected, not an alert.
    if (!list && local.minutes >= MORNING.announceAt && process.env.ANTHROPIC_API_KEY?.trim()) {
      // No row means the nightly build never ran. Create a failed one so the alert below posts exactly once.
      missing = true;
      await db.from("reachout_lists").upsert({ list_date: local.date, owner, status: "failed" }, { onConflict: "list_date,owner", ignoreDuplicates: true });
      ({ data: list } = await read());
    }
    const state = list ? { ...(list as unknown as ListState), rows: ((list as { rows?: ListRow[] }).rows ?? []), errors: ((list as { errors?: unknown[] }).errors ?? []) } : null;
    const ready = state?.status === "ready";
    const seatState = await seat(db, owner);
    const blocker = autoSendBlocker({ ...seatState, today: local.date });
    const cards = state && ready ? await todaysCards(db, owner, state.rows) : [];
    const kept = cards.filter((card) => card.auto_send_hold);
    const unsent = cards.filter((card) => !card.auto_send_hold && ["new", "edited", "approved"].includes(card.status) && card.email_subject?.trim() && card.email_body?.trim());
    const sending = local.minutes >= MORNING.sendFrom && local.minutes < MORNING.sendUntil;
    const leftovers = sending && !blocker ? await leftoverCards(db, owner, new Set(state?.rows.map((row) => row.domain) ?? [])) : [];

    // With the in-app build off, an empty list that is not ready is the same as no list: nothing to announce.
    const quietEmpty = Boolean(state && !ready && !state.rows.length && !process.env.ANTHROPIC_API_KEY?.trim());
    if (state && !quietEmpty && local.minutes >= MORNING.announceAt && !state.announced_at && await claim(db, state.id, "announced_at", now)) {
      const warning = owner === LIST_OWNERS[0] && windowProblems.length ? `\nCheck the morning send times: ${windowProblems.join("; ")}.` : "";
      const text = ready
        ? announceText({ seat: seatName(owner), rows: state.rows.map((row) => ({ company: row.company, ...rowForecast(row) })), blocker, size, link: listLink(owner) })
        : listAlertText({ seat: seatName(owner), status: missing ? "missing" : state.status === "building" ? "building" : "failed", rows: state.rows.length, size, errors: topErrors(state.errors), link: listLink(owner) });
      await postClaimed(db, state.id, "announced_at", post, `${text}${warning}`);
    }
    if (!ready && !leftovers.length) { out.push(state ? { owner, action: "no list", reason: state.status } : { owner, action: "no list" }); continue; }
    if (blocker) { out.push({ owner, action: "skipped", reason: blocker }); continue; }

    if (local.minutes >= MORNING.sendUntil) {
      if (state && !state.summary_posted_at && await claim(db, state.id, "summary_posted_at", now, { held_count: unsent.length })) {
        const held: HeldCard[] = unsent.map((card) => ({
          company: card.accounts?.name || card.accounts?.domain || "Unknown company",
          reason: addressProblem(card) ?? card.auto_send_hold_reason ?? "not reached before the send window closed",
        }));
        const { data: fresh } = await db.from("reachout_lists").select("sent_count").eq("id", state.id).maybeSingle();
        await postClaimed(db, state.id, "summary_posted_at", post, summaryText({ seat: seatName(owner), sent: Number(fresh?.sent_count ?? state.sent_count), held, kept: kept.length, link: listLink(owner) }));
      }
      out.push({ owner, action: "window closed" });
      continue;
    }
    if (local.minutes < MORNING.sendFrom) { out.push({ owner, action: "waiting" }); continue; }

    // Today's list first, then confirmed drafts left from earlier lists.
    const queue = [...unsent, ...leftovers];
    // Checked before every run's first send, so yesterday's bounces stop this morning before anything leaves.
    const bounces = await bounceCounts(db, owner, now, seatState.resumedAt);
    if (!bounces) { out.push({ owner, action: "held", reason: "could not read the bounce history" }); continue; }
    if (bounceBrake(bounces.sent, bounces.bounced, bounces.bouncedRecently)) {
      const reason = bounceReason(bounces.sent, bounces.bounced, bounces.bouncedRecently);
      await db.from("sender_profiles").update({ auto_send_paused: true, auto_send_paused_reason: reason }).eq("owner", owner);
      await Promise.resolve(post(pauseText({ seat: seatName(owner), reason, bounced: bounces.addresses, unsent: queue.length, listLink: listLink(owner), settingsLink: settingsLink() }))).catch(() => false);
      out.push({ owner, action: "paused", reason });
      continue;
    }

    const rowsByDomain = new Map((state?.rows ?? []).map((row) => [row.domain, row]));
    const todays = new Set(unsent.map((card) => card.id));
    const quota = paceForRun(queue.length, local.minutes);
    let sent = 0, sentToday = 0, held = 0, capped = false;
    for (const card of queue) {
      if (sent >= quota) break;
      const identity = identityHoldReason(rowsByDomain.get(card.accounts?.domain ?? ""));
      if (identity) { held += 1; if (card.auto_send_hold_reason !== identity) await holdCard(db, card, identity); continue; }
      if (clock() - started >= MORNING.runBudgetMs) { budgetSpent = true; break; }
      await sleep(Math.floor(random() * MORNING.maxJitterMs));
      if (clock() - started >= MORNING.runBudgetMs) { budgetSpent = true; break; }
      try {
        await send(db, { cardId: card.id, owner, subject: card.email_subject!, body: card.email_body!, baseUrl: configuredBaseUrl(), automatic: true });
        sent += 1;
        if (todays.has(card.id)) sentToday += 1;
      } catch (error) {
        // The day's cap is not the card's fault: stop for today and leave it untouched for tomorrow.
        if (CAP_REACHED.test(message(error))) { capped = true; break; }
        // Not confirmed deliverable, kept by hand or already sent: leave it on the desk for a person.
        held += 1;
        await holdCard(db, card, message(error));
        console.warn(`[night-watch] auto-send held ${card.accounts?.domain} for ${owner}: ${message(error)}`);
      }
    }
    if (state && ready) await addSentCount(db, state.id, sentToday);
    const reason = capped ? "the daily sending cap is reached; the rest go tomorrow" : budgetSpent ? "the run's time budget ran out; the rest go next run" : null;
    out.push({ owner, action: "sent", sent, held, ...(reason ? { reason } : {}) });
  }
  return out;
}
