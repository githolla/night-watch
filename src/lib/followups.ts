import { enrollCadence, CadenceExists } from "./cadence-enrollment.ts";
import type { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

type Db = ReturnType<typeof admin>;
export type FollowupChannel = "email" | "linkedin_message";
type FollowupStep = { day: number; channel: FollowupChannel; title: string; detail: string; subject: string | null; body: string };

/** The two follow-ups that run after the first touch (business day 3 and 10): hand-written, no model, so they
 *  work even offline. Two, not three: with a daily list going out, a third step pushed each mailbox past its
 *  daily cap within weeks. Warm, specific-enough bumps the sender can copy (or edit) on the day each comes due. */
/** A task or metric the follow-up may quote: plain text with no question mark or long dash. */
const quotable = (value: string | undefined) => {
  const text = value?.trim().replace(/\s+/g, " ").replace(/[.;:]+$/, "") ?? "";
  return text.length >= 4 && !/[?—–]/.test(text) ? text : "";
};

export function buildFollowups(channel: FollowupChannel, ctx: { firstName: string; company: string; baseSubject: string; task?: string; metric?: string }): FollowupStep[] {
  const name = ctx.firstName || "there";
  const company = ctx.company || "your team";
  const re = ctx.baseSubject ? `Re: ${ctx.baseSubject.replace(/[—–]/g, '-')}` : `Following up: ${company}`;
  const task = quotable(ctx.task);
  const metric = quotable(ctx.metric);
  // Only when both are known do the bumps name the work; otherwise the wording is exactly the generic one.
  const named = Boolean(task && metric);
  const bodies = [
    named
      ? `Hi ${name},\n\nFollowing up on ${task} for ${company}. A first version would be judged on one number: ${metric}.\n\nIs ${task} something your team would like help with?`
      : `Hi ${name},\n\nFollowing up on the project I suggested for ${company}. We'd work with the people doing the task, build a first version and test whether it saves them time.\n\nIs this a task your team would like help with?`,
    `Hi ${name},\n\nA useful first build should be easy to judge: compare the time your team spends on the task today with the time it takes using the new tool. Our engineers would handle the build, work through feedback and train the people using it.\n\nWho at ${company} would be best to talk with about that work?`,
    `Hi ${name},\n\nI'll leave this with you after this note. If ${named ? task : "the project in my first message"} becomes a priority at ${company}, our AI engineers can work alongside your team from the first build through testing and training.\n\nWould it be better to revisit this later?`,
  ];
  // Keeps the first and last of the original three; the middle "how we would measure it" note is dropped.
  return [0, 2].map((index, position) => ({day:[3,10][position],channel,title:['Follow up on the project','How we would measure it','Close the loop'][index],detail:'Continues the original project conversation',subject:channel==='email'?re:null,body:bodies[index]}));
}

/** Upgrade only known retired generated templates; preserve user-authored follow-up edits. */
export function refreshLegacyFollowup(body: string, ctx: {firstName:string;company:string;baseSubject:string;step:number;channel:FollowupChannel}) {
  const legacy = /Floating this back up in case it slipped by|most of the teams we work with start with a single workflow|If building this instead of hiring for it ever becomes|automating the work at .+ instead of hiring for it|teams like yours usually start by handing a single repetitive workflow|If automating that kind of work at/.test(body);
  // Older sequences have three steps; their third step is the closing note, which is now step two.
  const steps = buildFollowups(ctx.channel,ctx);
  return legacy ? steps[Math.max(0,Math.min(steps.length-1,ctx.step >= 3 ? steps.length-1 : ctx.step-1))].body : body;
}

/** Add N business days from now and land it mid-morning (roughly 10–11am US Eastern) so reminders come due on a workday. */
function scheduleBusinessDays(days: number): string {
  const cursor = new Date();
  let remaining = days;
  while (remaining > 0) { cursor.setUTCDate(cursor.getUTCDate() + 1); if (![0, 6].includes(cursor.getUTCDay())) remaining--; }
  while ([0, 6].includes(cursor.getUTCDay())) cursor.setUTCDate(cursor.getUTCDate() + 1);
  // Land at a random minute inside ~9am–5pm US Eastern (13:00–21:00 UTC) instead of a fixed time, so
  // a batch of follow-ups doesn't all fire on the same minute (which reads as automated to spam filters).
  const hour = 13 + Math.floor(Math.random() * 8);
  const minute = Math.floor(Math.random() * 60);
  cursor.setUTCHours(hour, minute, 0, 0);
  return cursor.toISOString();
}

/** After the first touch is recorded, stand up the next three follow-ups as a manual cadence on the same channel.
 *  Idempotent: does nothing if the card already has a cadence, so re-recording a touch never stacks duplicates. */
export async function ensureFollowupCadence(
  db: Db,
  ctx: { cardId: string; personId: string; owner: Owner; touchedChannel: string; firstName: string; company: string; baseSubject: string; task?: string; metric?: string },
): Promise<{ created: boolean; steps: number }> {
  const channel: FollowupChannel = ctx.touchedChannel === "email" ? "email" : "linkedin_message";
  const steps = buildFollowups(channel, { firstName: ctx.firstName, company: ctx.company, baseSubject: ctx.baseSubject, task: ctx.task, metric: ctx.metric });
  const rows = steps.map((step, index) => ({
    step_number: index + 1,
    channel: step.channel,
    // Email follow-ups auto-send (the cron falls back to a manual "ready" reminder when the recipient
    // isn't verified or Gmail isn't connected). LinkedIn steps are always manual reminders.
    kind: (step.channel === "email" ? "automatic" : "review") as "automatic" | "review",
    title: step.title,
    detail: step.detail,
    subject: step.subject,
    body: step.body,
    status: "pending" as const,
    scheduled_at: scheduleBusinessDays(step.day),
  }));
  try {
    const cadence=await enrollCadence(db,{cardId:ctx.cardId,personId:ctx.personId,owner:ctx.owner,mode:'manual',rules:{stop_on_reply:true,weekdays_only:true,time_zone:'America/New_York',origin:'touch'},steps:rows});
    return {created:true,steps:cadence.steps};
  }catch(error){if(error instanceof CadenceExists)return {created:false,steps:0};throw error;}
}
