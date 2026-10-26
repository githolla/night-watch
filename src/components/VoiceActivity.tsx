import { CallActivityRefresh } from "@/components/CallActivityRefresh";
import { operationalVoiceOutcome } from "@/lib/voice-policy";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";
import { formatCallPhone } from "@/lib/call-plan";

const row = z.object({ id: z.string(), created_at: z.string(), scheduled_at: z.string().nullable(), dispatched_at: z.string().nullable(), mode: z.string(), status: z.string(), destination: z.string(), review_required: z.boolean(), ended_reason: z.string().nullable(), context_snapshot: z.record(z.string(), z.unknown()), report: z.unknown().nullable() });
export async function VoiceActivity({ owner }: { owner: Owner }) {
  const db = admin();
  const result = await db.from("voice_attempts").select("id,created_at,scheduled_at,dispatched_at,mode,status,destination,review_required,ended_reason,context_snapshot,report").eq("owner", owner).order("created_at", { ascending: false }).limit(200);
  if (result.error) return <section className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600">Call activity could not be loaded. Refresh to try again. Your call prep is available below.</section>;
  const attempts = z.array(row).safeParse(result.data);
  if (!attempts.success) return null;
  const actions = attempts.data.length ? await db.from("voice_actions").select("id,attempt_id,kind,status,details,result").in("attempt_id", attempts.data.map(item => item.id)).order("created_at", { ascending: false }).limit(60) : { data: [], error: null };
  const records = z.array(z.object({ id: z.string(), attempt_id: z.string(), kind: z.string(), status: z.string(), details: z.record(z.string(), z.unknown()), result: z.unknown().nullable() })).safeParse(actions.data);
  const live = attempts.data.filter(attempt => attempt.mode === "pilot");
  const upcoming = live.filter(attempt => ["queued", "creating", "active"].includes(attempt.status)).sort((a, b) => Date.parse(a.scheduled_at ?? a.created_at) - Date.parse(b.scheduled_at ?? b.created_at));
  const history = live.filter(attempt => !["queued", "creating", "active"].includes(attempt.status)).sort((a, b) => Date.parse(b.dispatched_at ?? b.created_at) - Date.parse(a.dispatched_at ?? a.created_at));
  const tests = attempts.data.filter(attempt => attempt.mode === "internal");
  const groups = [{ title: "Upcoming calls", items: upcoming, empty: "No calls are currently queued. Eligible follow-ups will appear here automatically." }, { title: "Call history", items: history, empty: "No completed prospect calls yet." }];
  const time = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const renderAttempt = (attempt: z.infer<typeof row>) => {

      const contact = z.object({ name: z.string() }).safeParse(attempt.context_snapshot.contact);
      const operational = z.object({ operational: z.object({ outcome: z.string().nullable() }) }).safeParse(attempt.report);
      const report = z.object({ analysis: z.unknown(), transcript: z.string().optional() }).safeParse(attempt.report);
      const previous = operational.success ? operational.data.operational.outcome : null;
      const outcome = report.success && previous === "no_answer" ? operationalVoiceOutcome(report.data.analysis, { meetingConfirmed: false, suppressed: false, callbackSaved: false, emailQueued: false }, { transcript: report.data.transcript, endedReason: attempt.ended_reason ?? undefined }).outcome : previous;
      const summary = z.object({ summary: z.string() }).safeParse(report.success ? report.data.analysis : null);
      return <article key={attempt.id} className="mt-3 rounded-lg border border-stone-200 p-3">
        <div className="text-sm"><strong>{contact.success ? contact.data.name : "Audio test"}</strong> · {typeof attempt.context_snapshot.company_name === "string" ? attempt.context_snapshot.company_name : "Internal test"} · {attempt.status === "creating" ? "Connecting" : attempt.status === "active" ? "In progress" : attempt.status === "queued" ? "Scheduled" : attempt.status === "ended" ? "Call ended" : attempt.status}{attempt.review_required ? " · Needs review" : ""}<span className="ml-3 text-stone-500">{formatCallPhone(attempt.destination)}</span></div>
        <p className="mt-2 text-xs text-stone-500">{attempt.dispatched_at ? `Called ${time(attempt.dispatched_at)}` : attempt.scheduled_at ? `Scheduled ${time(attempt.scheduled_at)}` : `Added ${time(attempt.created_at)}`}{attempt.ended_reason ? ` · ${attempt.ended_reason}` : ""}{outcome ? ` · ${outcome.replaceAll("_", " ")}` : ""}</p>
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-emerald-700">View transcript</summary><div className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-4 leading-relaxed text-stone-800">{report.success && report.data.transcript ? report.data.transcript.replace(/^AI:/gm, "Alex:").replace(/^User:/gm, "Other party:") : "No transcript has been received for this call yet."}</div></details>
        {summary.success && <p className="mt-2 text-sm text-stone-600">{summary.data.summary}</p>}
        {actions.error && <p className="mt-2 text-sm text-amber-700">Follow-up requests could not be loaded. Refresh before taking action.</p>}
        {records.success && records.data.filter(action => action.attempt_id === attempt.id).map(action => <div key={action.id} className="mt-2 rounded-md bg-stone-50 p-3 text-sm"><strong>{action.kind.replaceAll("_", " ")}</strong> · {action.status}<p className="mt-1 whitespace-pre-wrap text-stone-600">{typeof action.details.reason === "string" ? action.details.reason : "Review the saved action details."}</p>{typeof action.details.expressed_words === "string" && <p className="mt-1 text-stone-500">Prospect words: {action.details.expressed_words}</p>}{typeof action.details.start === "string" && <p className="mt-1 text-stone-600">Requested callback: {action.details.start} · {typeof action.details.timezone === "string" ? action.details.timezone : "Timezone needs review"}</p>}</div>)}
        <details className="mt-3 text-sm"><summary className="cursor-pointer text-stone-600">View sent email</summary>
          <p className="mt-2 text-stone-600">{typeof attempt.context_snapshot.company_name === "string" ? attempt.context_snapshot.company_name : "Internal audio test"}</p>
          {typeof attempt.context_snapshot.email_sent_at === "string" && <p className="mt-1 text-xs text-stone-500">Email sent {new Date(attempt.context_snapshot.email_sent_at).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}</p>}
          {typeof attempt.context_snapshot.email_body === "string" && <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-sm">{attempt.context_snapshot.email_body}</p>}

        </details>
      </article>;
  };
  return <section className="my-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold text-stone-900">Automatic calls</h2><p className="mt-1 text-sm text-stone-500">Alex’s prospect calls, separate from internal tests. All times Eastern.</p></div><CallActivityRefresh /></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[
      ["Calls made", live.filter(attempt => attempt.dispatched_at).length],
      ["In progress", upcoming.filter(attempt => attempt.status !== "queued").length],
      ["Upcoming", upcoming.filter(attempt => attempt.status === "queued").length],
      ["Needs attention", live.filter(attempt => attempt.review_required || attempt.status === "held").length],
    ].map(([label, count]) => <div key={label} className="rounded-xl border border-stone-200 bg-white p-4"><p className="text-xs font-medium text-stone-500">{label}</p><p className="mt-1 text-2xl font-semibold text-stone-900">{count}</p></div>)}</div>
    <div className="grid gap-4 xl:grid-cols-2">{groups.map(group => <section key={group.title} className="rounded-xl border border-stone-200 bg-white p-4"><h3 className="font-semibold text-stone-900">{group.title} <span className="ml-2 text-sm font-normal text-stone-500">{group.items.length}</span></h3>{!group.items.length && <p className="py-5 text-sm text-stone-500">{group.empty}</p>}{group.items.map(renderAttempt)}</section>)}</div>
    <p className="text-xs text-stone-500">Scheduled times are targets. Calls run one at a time during approved local calling hours. Use View transcript beneath a call to read the conversation, or View sent email for its context. Showing up to 200 recent records.</p>
    {tests.length > 0 && <details className="rounded-xl border border-stone-200 bg-white p-4"><summary className="cursor-pointer text-sm font-medium text-stone-600">Internal test calls ({tests.length})</summary>{tests.map(renderAttempt)}</details>}
  </section>;
}
