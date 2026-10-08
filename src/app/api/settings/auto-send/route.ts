import { requireUser } from "@/lib/auth";
import { listReport, nightSpend } from "@/lib/list-build-report";
import { localParts } from "@/lib/local-time";
import { nightlyListConfig } from "@/lib/nightly-list-builder";
import { isSendDay, MORNING } from "@/lib/morning-send-rules";
import { dailyCap, sendDayStart } from "@/lib/send-guards";
import { admin } from "@/lib/supabase/admin";
import { nextFollowups } from "@/lib/next-followups";
import { z } from "zod";

const owner = z.enum(["josh", "suuchi"]);
const input = z.object({ owner: owner.optional(), autoSend: z.boolean().optional(), paused: z.boolean().optional(), skipToday: z.boolean().optional() });
const daysSince = (iso: string | null | undefined) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null);

async function seatState(seat: "josh" | "suuchi") {
  const db = admin();
  const today = localParts().date;
  const local = localParts();
  const [{ data: profile, error }, { data: list }, { data: connection }, { count: sentToday }] = await Promise.all([
    db.from("sender_profiles").select("*").eq("owner", seat).maybeSingle(),
    db.from("reachout_lists").select("status,rows,attempts,sent_count,held_count,announced_at,summary_posted_at,errors").eq("owner", seat).eq("list_date", today).maybeSingle(),
    db.from("gmail_connections").select("connected_at,created_at").eq("owner", seat).maybeSingle(),
    // Counted the way the send guard counts toward the daily cap: emails that left through Gmail since local midnight.
    db.from("touches").select("id", { count: "exact", head: true }).eq("sent_by", seat).eq("channel", "email").not("gmail_thread_id", "is", null).gte("sent_at", sendDayStart().toISOString()),
  ]);
  if (error) throw new Error(error.message);
  const daysConnected = connection ? daysSince((connection.connected_at as string | null) ?? (connection.created_at as string | null)) : null;
  return {
    owner: seat,
    autoSend: Boolean(profile?.auto_send),
    paused: Boolean(profile?.auto_send_paused),
    pausedReason: (profile?.auto_send_paused_reason as string | null) ?? null,
    postalAddressSet: Boolean(((profile?.postal_address as string | null) ?? "").trim()),
    migrated: profile ? "auto_send" in profile : true,
    /** Migration 0030: the one-day skip and the resume time. */
    safetyMigrated: profile ? "auto_send_skip_on" in profile : false,
    skippedToday: ((profile?.auto_send_skip_on as string | null | undefined) ?? null) === today,
    /** Warm-up: the cap a new mailbox ramps up to, and how long it has been connected. */
    dailyCap: dailyCap(daysConnected ?? 0),
    daysConnected,
    sentToday: sentToday ?? 0,
    followupsNeedYou: [...(await nextFollowups(db, { owner: seat }).catch(() => new Map())).values()].filter((next) => next.needsYou).length,
    sendDay: isSendDay(local.weekday, local.date), minutesNow: local.minutes, sendFrom: MORNING.sendFrom, sendUntil: MORNING.sendUntil,
    today: list ? listReport(list as Parameters<typeof listReport>[0], nightlyListConfig().research) : null,
  };
}

/** The night's spend across both seats, shown once: the budget is shared, so a member sees the full total too. */
async function nightState() {
  const { data } = await admin().from("reachout_lists").select("cost_usd").eq("list_date", localParts().date);
  return nightSpend((data ?? []) as Array<{ cost_usd: unknown }>, nightlyListConfig().budgetUsd);
}

/** The viewer's seat, or both seats for an admin. */
export async function GET() {
  try {
    const user = await requireUser();
    const seats = user.role === "admin" ? ["josh", "suuchi"] as const : [user.owner];
    const [states, night] = await Promise.all([Promise.all(seats.map(seatState)), nightState()]);
    return Response.json({ seats: states, night });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load auto-send" }, { status: 400 });
  }
}

/** Turn auto-send on or off, pause and resume it, or skip today. A member changes only their own seat. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = input.parse(await request.json());
    const seat = body.owner ?? user.owner;
    if (seat !== user.owner && user.role !== "admin") return Response.json({ error: "You can only change your own auto-send." }, { status: 403 });
    const current = await seatState(seat);
    if (!current.migrated) throw new Error("Run supabase/migrations/0027_nightly_lists.sql in the Supabase SQL editor first.");
    if (body.autoSend === true && !current.postalAddressSet) throw new Error("Add the business postal address under Sender identity first. US law requires it in commercial email.");
    if (body.skipToday !== undefined && !current.safetyMigrated) throw new Error("Run supabase/migrations/0030_send_safety.sql in the Supabase SQL editor first.");
    const patch: Record<string, unknown> = { owner: seat };
    if (body.autoSend !== undefined) patch.auto_send = body.autoSend;
    if (body.paused !== undefined) { patch.auto_send_paused = body.paused; if (!body.paused) patch.auto_send_paused_reason = null; else patch.auto_send_paused_reason = `Paused by ${user.actor?.name ?? user.name}`; }
    // The bounce brake counts only first emails sent after a resume, so the bounces that paused it cannot pause it again.
    if (body.paused === false && current.paused && current.safetyMigrated) patch.auto_send_resumed_at = new Date().toISOString();
    if (body.skipToday !== undefined) patch.auto_send_skip_on = body.skipToday ? localParts().date : null;
    const { error } = await admin().from("sender_profiles").upsert(patch, { onConflict: "owner" });
    if (error) throw new Error(error.message);
    return Response.json({ seat: await seatState(seat) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not change auto-send" }, { status: 400 });
  }
}
