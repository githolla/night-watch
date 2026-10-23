import { admin } from "@/lib/supabase/admin";
import type { CallTask } from "@/lib/call-tasks";

export async function VoicePilotReadiness({ tasks, now }: { tasks: CallTask[]; now: number }) {
  const db = admin();
  const [config, approvals] = await Promise.all([
    db.from("voice_pilot_config").select("enabled,daily_limit,starts_at,ends_at,booking_test_passed,voicemail_test_passed,optout_test_passed").eq("id", true).maybeSingle(),
    db.from("voice_eligibility").select("*"),
  ]);
  const pending = tasks.filter(task => task.plan.status === "pending");
  const ready = pending.filter(task => {
    const digits = task.plan.phone?.number.replace(/\D/g, "") ?? "";
    const number = `+${digits.length === 10 ? "1" : ""}${digits}`;
    return (approvals.data ?? []).some(approval => approval.person_id === task.personId && approval.approved_number === number && approval.approval_basis && approval.approval_evidence?.trim() && approval.timezone_source?.trim() && Date.parse(approval.approved_until) > now);
  }).length;
  const checksPassed = config.data?.booking_test_passed && config.data?.voicemail_test_passed && config.data?.optout_test_passed;
  const active = Boolean(!config.error && config.data?.enabled && checksPassed && now < Date.parse(config.data.ends_at));
  const date = new Date(config.data?.starts_at ?? "2026-10-26T13:00:00Z").toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
  return <section className="my-4 rounded-xl border border-stone-200 bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-stone-900">Alex calling pilot</h2><span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-700">{active ? "Scheduled" : "Not activated"}</span></div>
    <p className="mt-2 text-sm text-stone-600">{date} · Up to {config.data?.daily_limit ?? 5} calls · One at a time · 9am to 5pm in the recipient’s timezone.</p>
    <p className="mt-2 text-sm text-stone-700">{pending.length} pending follow-ups · {approvals.error ? "Approval checks unavailable" : `${ready} with documented phone approval`}.</p>
    {!active && <p className="mt-2 text-sm text-amber-800">Prospect calls are off. Launch requires eligible contacts and successful real booking, voicemail and opt-out tests.</p>}
    <p className="mt-2 text-xs text-stone-500">Alex follows the sent email. Voicemail asks for an email reply or callback. Replies, bounces, opt-outs and existing meetings hold further calls.</p>
  </section>;
}
