import type { SupabaseClient } from "@supabase/supabase-js";
import { sendableAddress } from "./bulk-sendable.ts";
import { localParts } from "./local-time.ts";
import { autoSendQueue } from "./morning-send.ts";
import { isSendDay, MORNING } from "./morning-send-rules.ts";
import { dailyCap, sendDayStart } from "./send-guards.ts";
import { buildSendPlan, type SendPlan } from "./send-plan.ts";
import type { Owner } from "./types.ts";

const DAY_MS = 86_400_000;
const daysSince = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / DAY_MS)) : 0);

/** The next send day after today in the send time zone, as a weekday name and a YYYY-MM-DD date. */
function nextSendDay(now: Date): { label: string; date: string } {
  for (let ahead = 1; ahead <= 14; ahead++) {
    const local = localParts(new Date(now.getTime() + ahead * DAY_MS));
    if (isSendDay(local.weekday, local.date)) {
      const label = new Date(`${local.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      return { label, date: local.date };
    }
  }
  return { label: "the next send day", date: localParts(now).date };
}

/** The morning run tries today's list even without a usable address and then holds it; count those as held up front. */
async function withAddressHolds(db: SupabaseClient, queue: Array<{ cardId: string; held: string | null }>) {
  const ids = queue.filter((entry) => !entry.held).map((entry) => entry.cardId);
  if (!ids.length) return queue;
  const { data } = await db.from("cards").select("id,people(email,email_status,email_check,do_not_contact)").in("id", ids);
  type Row = { id: string; people: { email: string | null; email_status: string | null; email_check: unknown; do_not_contact: boolean | null } | null };
  const unusable = new Set(((data ?? []) as unknown as Row[]).filter((row) => !row.people || row.people.do_not_contact || !sendableAddress(row.people)).map((row) => row.id));
  return queue.map((entry) => (unusable.has(entry.cardId) ? { ...entry, held: "no usable email address" } : entry));
}

/** What the morning auto-send will do next for one seat, from its own queue and limits. Read-only. */
export async function loadSendPlan(db: SupabaseClient, owner: Owner, now: Date = new Date()): Promise<SendPlan> {
  const local = localParts(now);
  const next = nextSendDay(now);
  const [{ data: profile }, { data: connection }, { count: sentToday }] = await Promise.all([
    db.from("sender_profiles").select("*").eq("owner", owner).maybeSingle(),
    db.from("gmail_connections").select("connected_at,created_at").eq("owner", owner).maybeSingle(),
    db.from("touches").select("id", { count: "exact", head: true }).eq("sent_by", owner).eq("channel", "email").not("gmail_thread_id", "is", null).gte("sent_at", sendDayStart(now).toISOString()),
  ]);
  const sendDay = isSendDay(local.weekday, local.date);
  const seat = {
    autoSend: Boolean(profile?.auto_send), paused: Boolean(profile?.auto_send_paused),
    postalAddressSet: Boolean(((profile?.postal_address as string | null) ?? "").trim()),
    skippedToday: ((profile?.auto_send_skip_on as string | null | undefined) ?? null) === local.date,
    sentToday: sentToday ?? 0,
    dailyCap: dailyCap(daysSince((connection?.connected_at as string | null) ?? (connection?.created_at as string | null), now.getTime())),
  };
  const todayAhead = sendDay && !seat.skippedToday && local.minutes < MORNING.sendUntil;
  const queue = await withAddressHolds(db, await autoSendQueue(db, owner, todayAhead ? local.date : next.date));
  return buildSendPlan(queue, seat, {
    sendDay, minutesNow: local.minutes, sendFrom: MORNING.sendFrom, sendUntil: MORNING.sendUntil,
    runEveryMinutes: MORNING.runEveryMinutes, maxPerRun: MORNING.maxPerRun, nextSendDayLabel: next.label, todayLabel: "today",
  });
}
