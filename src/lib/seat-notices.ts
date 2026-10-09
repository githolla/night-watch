import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAutoSendView } from "./autosend-view.ts";
import { sendEmail } from "./gmail.ts";
import { localParts } from "./local-time.ts";
import { isSendDay } from "./morning-send-rules.ts";
import { configuredBaseUrl } from "./opt-out.ts";
import { headsUpNotice, recapNotice, replyNotice, weeklyNotice, type Notice } from "./seat-notice-text.ts";
import { loadSentView } from "./sent-view.ts";
import type { Owner } from "./types.ts";

type Db = SupabaseClient;
const SEATS: Owner[] = ["josh", "suuchi"];
/** Minutes after midnight in the send time zone. The cron fires every ten minutes, so each slot is hit once. */
export const NOTICE_SLOTS = { headsUp: 8 * 60 + 30, recap: 11 * 60 + 40, weekly: 12 * 60 } as const;
const inSlot = (minutes: number, start: number) => minutes >= start && minutes < start + 10;

/**
 * Record that this notice went out. False when it already has (a second cron run). Before migration 0032
 * there is no table, and the ten-minute slot alone keeps it to one.
 */
async function claim(db: Db, owner: Owner, kind: string, key: string): Promise<boolean> {
  const { error } = await db.from("seat_notifications").insert({ owner, kind, key });
  if (!error) return true;
  if (error.code === "23505") return false;
  return /seat_notifications|42P01|PGRST205/.test(`${error.code} ${error.message}`);
}
const release = (db: Db, owner: Owner, kind: string, key: string) => db.from("seat_notifications").delete().eq("owner", owner).eq("kind", kind).eq("key", key);

/** From the seat's own Gmail to the seat's own address, so it lands in their inbox and nowhere else. */
export async function sendToSelf(db: Db, owner: Owner, notice: Notice, send: typeof sendEmail = sendEmail) {
  const { data: connection } = await db.from("gmail_connections").select("email").eq("owner", owner).maybeSingle();
  const address = (connection?.email as string | undefined)?.trim();
  if (!address) throw new Error("Gmail is not connected.");
  await send(owner, `Night Watch <${address}>`, address, notice.subject, notice.text, undefined, undefined, notice.html);
}

async function firstName(db: Db, owner: Owner) {
  const { data } = await db.from("sender_profiles").select("from_name").eq("owner", owner).maybeSingle();
  return ((data?.from_name as string | undefined) ?? "").trim().split(/\s+/)[0] || (owner === "josh" ? "Josh" : "Suuchi");
}

type Deps = { send?: typeof sendEmail; autoSendView?: typeof loadAutoSendView; sentView?: typeof loadSentView };

/** The morning heads-up, the recap and the Friday note, each in its slot. Read-only apart from the emails. */
export async function runSeatNotices(db: Db, now: Date = new Date(), deps: Deps = {}) {
  const local = localParts(now);
  const base = configuredBaseUrl();
  const out: Array<{ owner: Owner; kind: string; result: string }> = [];
  for (const owner of SEATS) {
    const deliver = async (kind: string, key: string, build: () => Promise<Notice | null>) => {
      try {
        const notice = await build();
        if (!notice) { out.push({ owner, kind, result: "nothing to say" }); return; }
        if (!(await claim(db, owner, kind, key))) { out.push({ owner, kind, result: "already sent" }); return; }
        try { await sendToSelf(db, owner, notice, deps.send); out.push({ owner, kind, result: "sent" }); }
        catch (error) { await release(db, owner, kind, key); throw error; }
      } catch (error) { out.push({ owner, kind, result: error instanceof Error ? error.message : "failed" }); }
    };
    const sendDay = isSendDay(local.weekday, local.date);
    if (sendDay && inSlot(local.minutes, NOTICE_SLOTS.headsUp)) await deliver("heads-up", local.date, async () => {
      const { plan, emails, control } = await (deps.autoSendView ?? loadAutoSendView)(owner);
      if (!control.autoSend || control.paused || !control.postalAddressSet || control.skippedToday || plan.when !== "today" || plan.going === 0) return null;
      const going = emails.filter((email) => email.group === "going").map((email) => ({ time: email.time, name: email.name, title: email.title, company: email.company }));
      return headsUpNotice({ first: await firstName(db, owner), going, window: plan.windowLabel, later: plan.later, link: `${base}/auto-send` });
    });
    if (sendDay && inSlot(local.minutes, NOTICE_SLOTS.recap)) await deliver("recap", local.date, async () => {
      const { control } = await (deps.autoSendView ?? loadAutoSendView)(owner);
      const stats = await (deps.sentView ?? loadSentView)(owner, 1, now);
      if (!control.autoSend || stats.sent === 0) return null;
      const outcome = { interested: "interested", replied: "replied", bounced: "bounced", "out of office": "out of office", sent: "sent" } as const;
      return recapNotice({ first: await firstName(db, owner), sent: stats.recent.map((row) => ({ name: row.name, company: row.company, outcome: outcome[row.outcome] })), replies: stats.replies, bounced: stats.bounced, cap: (await (deps.autoSendView ?? loadAutoSendView)(owner)).plan.dailyCap, link: `${base}/drafts/sent?days=1` });
    });
    if (local.weekday === "Fri" && inSlot(local.minutes, NOTICE_SLOTS.weekly)) await deliver("weekly", local.date, async () => {
      const stats = await (deps.sentView ?? loadSentView)(owner, 7, now);
      if (stats.sent === 0) return null;
      const replied = stats.recent.filter((row) => !row.followup && (row.outcome === "replied" || row.outcome === "interested"));
      const counts = new Map<string, number>();
      for (const row of replied) counts.set(row.industry, (counts.get(row.industry) ?? 0) + 1);
      return weeklyNotice({
        first: await firstName(db, owner), sent: stats.sent, firsts: stats.firsts, followups: stats.followups, replies: stats.replies, interested: stats.interested,
        bounced: stats.bounced, replyRate: stats.replyRate, bounceRate: stats.bounceRate,
        topIndustries: [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
        interestedPeople: stats.recent.filter((row) => row.outcome === "interested").map((row) => ({ name: row.name, company: row.company, outcome: "interested" })),
        link: `${base}/drafts/sent?days=7`,
      });
    });
  }
  return out;
}

/** A reply landed: tell the seat in their inbox. Never throws; a missed alert must not stall reply processing. */
export async function sendReplyAlert(db: Db, input: { owner: Owner; cardId: string; name: string; title: string | null; company: string; classification: string; body: string }, send: typeof sendEmail = sendEmail) {
  if (["ooo", "none"].includes(input.classification)) return false;
  try {
    const base = configuredBaseUrl();
    // The reply's own words, without the quoted thread underneath.
    const snippet = input.body.split(/\n\s*(?:On .{5,120} wrote:|-{2,}\s*Original Message|From: )/)[0] ?? "";
    await sendToSelf(db, input.owner, replyNotice({ name: input.name, title: input.title, company: input.company, classification: input.classification, snippet, briefLink: `${base}/brief/${input.cardId}`, historyLink: `${base}/activity` }), send);
    return true;
  } catch { return false; }
}
