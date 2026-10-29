import { z } from "zod";
import type { CallTask } from "./call-tasks.ts";
import { admin } from "./supabase/admin.ts";
import { senderProfile } from "./sender.ts";
import { thread } from "./gmail.ts";
import { voiceFollowup } from "./voice-followup.ts";
import { allFocus } from "./focus-data.ts";

export async function currentVoiceFollowup(task: CallTask, timezone?: string) {
  const db = admin();
  const [sender, person, history, profile] = await Promise.all([
    db.from("gmail_connections").select("email").eq("owner", task.owner).single(),
    db.from("people").select("account_id").eq("id", task.personId).single(),
    db.from("touches").select("sent_at,gmail_thread_id,body,bounced_at,reply_at,reply_classification").eq("person_id", task.personId).eq("sent_by", task.owner).eq("channel", "email").not("sent_at", "is", null).order("sent_at", { ascending: true }).limit(100),
    senderProfile(db, task.owner),
  ]);
  if (sender.error || person.error || history.error) throw new Error("Could not verify current sender and email history.");
  const touches = z.array(z.object({ sent_at: z.string(), gmail_thread_id: z.string().nullable(), body: z.string().nullable(), bounced_at: z.string().nullable(), reply_at: z.string().nullable(), reply_classification: z.string().nullable() })).parse(history.data);
  if (!touches.length || touches.some(t => t.bounced_at || t.reply_at)) throw new Error("Reply or bounce requires handling before automated follow-up.");
  const first = touches[0];
  if (!first.body?.trim() || Date.parse(first.sent_at) !== Date.parse(task.plan.firstEmailAt)) throw new Error("Sent email context changed. Reload the call task.");
  let subject: string | undefined;
  if (first.gmail_thread_id) {
    const mailbox = await thread(task.owner, first.gmail_thread_id);
    const ours = String(sender.data.email).toLowerCase();
    const inbound = mailbox.messages.some(message => {
      const from = message.payload.headers.find(header => header.name.toLowerCase() === "from")?.value.toLowerCase() ?? "";
      return Number(message.internalDate) > Date.parse(first.sent_at) && !from.includes(ours);
    });
    if (inbound) throw new Error("New inbound email requires handling before automated follow-up.");
    const matched = mailbox.messages.filter(message => Math.abs(Number(message.internalDate) - Date.parse(first.sent_at)) < 120_000).find(message => {
      const headers = message.payload.headers;
      const from = headers.find(header => header.name.toLowerCase() === "from")?.value.toLowerCase() ?? "";
      const to = headers.find(header => header.name.toLowerCase() === "to")?.value.toLowerCase() ?? "";
      return from.includes(String(sender.data.email).toLowerCase()) && Boolean(task.email && to.includes(task.email.toLowerCase()));
    });
    subject = matched?.payload.headers.find(header => header.name.toLowerCase() === "subject")?.value;
  }
  const row = allFocus().find(item => item.domain.toLowerCase() === task.domain.toLowerCase());
  return voiceFollowup({ ...task, emailBody: first.body }, new Date(), { timezone, senderAddress: String(sender.data.email), senderName: profile.fromName, senderTitle: profile.title, subject, companyId: String(person.data.account_id), industry: row?.sector });
}
