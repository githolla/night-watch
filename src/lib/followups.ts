import type { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

type Db = ReturnType<typeof admin>;
export type FollowupChannel = "email" | "linkedin_message";
type FollowupStep = { day: number; channel: FollowupChannel; title: string; detail: string; subject: string | null; body: string };

/** The three follow-ups that run after the first touch — hand-written, no model, so they work even offline.
 *  Warm, specific-enough bumps the sender can copy (or edit) on the day each one comes due. */
export function buildFollowups(channel: FollowupChannel, ctx: { firstName: string; company: string; baseSubject: string }): FollowupStep[] {
  const name = ctx.firstName || "there";
  const company = ctx.company || "your team";
  const re = ctx.baseSubject ? `Re: ${ctx.baseSubject}` : `Following up — ${company}`;
  if (channel === "email") {
    return [
      { day: 3, channel, title: "Follow-up email", detail: "A short bump on the first note, same thread", subject: re,
        body: `Hi ${name},\n\nFloating this back up in case it slipped by. Happy to put together a quick, no-obligation teardown of one role at ${company} and exactly what we'd build to do that work instead of hiring for it.\n\nWorth a look?` },
      { day: 7, channel, title: "A concrete angle", detail: "Give one specific example of the build", subject: re,
        body: `Hi ${name},\n\nOne more thought: most of the teams we work with start with a single workflow — the reporting, the data entry, the routing — and let one system own it end to end before touching anything else.\n\nIf there's one repetitive thing your team wishes it never had to staff for, tell me what it is and I'll sketch how we'd automate it.` },
      { day: 14, channel, title: "Close the loop", detail: "A soft sign-off that leaves the door open", subject: re,
        body: `Hi ${name},\n\nI'll leave it here for now so I'm not cluttering your inbox. If building this instead of hiring for it ever becomes a priority at ${company}, just reply and I'll pick it right back up.\n\nThanks for the time either way.` },
    ];
  }
  return [
    { day: 3, channel, title: "LinkedIn nudge", detail: "A light follow-up message", subject: null,
      body: `Hi ${name} — just following up on my note. No pressure at all; I know inboxes and DMs pile up. If the idea of automating the work at ${company} instead of hiring for it is interesting, happy to share a quick example.` },
    { day: 7, channel, title: "Share an idea", detail: "Offer a specific build idea", subject: null,
      body: `Hey ${name}, one concrete thought — teams like yours usually start by handing a single repetitive workflow (reporting, data entry, routing) to one system that owns it end to end. If there's one your team wishes it didn't have to staff for, tell me and I'll sketch how we'd build it.` },
    { day: 14, channel, title: "Soft close", detail: "A friendly last touch", subject: null,
      body: `Hi ${name} — I'll leave this here for now. If automating that kind of work at ${company} ever moves up the list, just message me and I'll jump back in. Appreciate you either way.` },
  ];
}

/** Add N business days from now and land it mid-morning (roughly 10–11am US Eastern) so reminders come due on a workday. */
function scheduleBusinessDays(days: number): string {
  const cursor = new Date();
  let remaining = days;
  while (remaining > 0) { cursor.setUTCDate(cursor.getUTCDate() + 1); if (![0, 6].includes(cursor.getUTCDay())) remaining--; }
  while ([0, 6].includes(cursor.getUTCDay())) cursor.setUTCDate(cursor.getUTCDate() + 1);
  cursor.setUTCHours(15, 0, 0, 0);
  return cursor.toISOString();
}

/** After the first touch is recorded, stand up the next three follow-ups as a manual cadence on the same channel.
 *  Idempotent: does nothing if the card already has a cadence, so re-recording a touch never stacks duplicates. */
export async function ensureFollowupCadence(
  db: Db,
  ctx: { cardId: string; personId: string; owner: Owner; touchedChannel: string; firstName: string; company: string; baseSubject: string },
): Promise<{ created: boolean; steps: number }> {
  const { data: existing } = await db.from("cadences").select("id").eq("card_id", ctx.cardId).maybeSingle();
  if (existing) return { created: false, steps: 0 };

  const channel: FollowupChannel = ctx.touchedChannel === "email" ? "email" : "linkedin_message";
  const { data: cadence, error } = await db.from("cadences").insert({
    card_id: ctx.cardId,
    person_id: ctx.personId,
    owner: ctx.owner,
    mode: "manual",
    status: "active",
    rules: { stop_on_reply: true, weekdays_only: true, send_window: "9:30–16:00", time_zone: "America/New_York", origin: "touch" },
    activated_at: new Date().toISOString(),
  }).select("id").single();
  if (error || !cadence) return { created: false, steps: 0 };

  const steps = buildFollowups(channel, { firstName: ctx.firstName, company: ctx.company, baseSubject: ctx.baseSubject });
  const rows = steps.map((step, index) => ({
    cadence_id: cadence.id as string,
    step_number: index + 1,
    channel: step.channel,
    kind: "review" as const,
    title: step.title,
    detail: step.detail,
    subject: step.subject,
    body: step.body,
    status: "pending" as const,
    scheduled_at: scheduleBusinessDays(step.day),
  }));
  const { error: stepsError } = await db.from("cadence_steps").insert(rows);
  if (stepsError) return { created: false, steps: 0 };
  return { created: true, steps: rows.length };
}
