import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";
import { formatCallPhone } from "@/lib/call-plan";

const row = z.object({ id: z.string(), created_at: z.string(), mode: z.string(), status: z.string(), destination: z.string(), review_required: z.boolean(), ended_reason: z.string().nullable(), context_snapshot: z.record(z.string(), z.unknown()), report: z.unknown().nullable() });
export async function VoiceActivity({ owner }: { owner: Owner }) {
  const db = admin();
  const result = await db.from("voice_attempts").select("id,created_at,mode,status,destination,review_required,ended_reason,context_snapshot,report").eq("owner", owner).order("created_at", { ascending: false }).limit(12);
  if (result.error) return <section className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600">AI follow-up is in internal testing. Your manual call queue is available below.</section>;
  const attempts = z.array(row).safeParse(result.data);
  if (!attempts.success) return null;
  const actions = attempts.data.length ? await db.from("voice_actions").select("id,attempt_id,kind,status,details,result").in("attempt_id", attempts.data.map(item => item.id)).order("created_at", { ascending: false }).limit(60) : { data: [], error: null };
  const records = z.array(z.object({ id: z.string(), attempt_id: z.string(), kind: z.string(), status: z.string(), details: z.record(z.string(), z.unknown()), result: z.unknown().nullable() })).safeParse(actions.data);
  return <details className="my-4 rounded-xl border border-stone-200 bg-white p-4">
    <summary className="cursor-pointer font-medium text-stone-900">AI follow-up activity <span className="ml-2 text-sm font-normal text-stone-500">Call records and follow-up tasks</span></summary>
    <p className="mt-2 text-sm text-stone-600">Review what Alex knew, what happened, and which requests need a person. Rehearsal outreach actions are simulated. Explicit live-calendar tests create a real event labelled TEST.</p>
    {!attempts.data.length && <p className="mt-3 text-sm text-stone-500">No recorded AI call attempts yet.</p>}
    {attempts.data.map(attempt => {
      const contact = z.object({ name: z.string() }).safeParse(attempt.context_snapshot.contact);
      const operational = z.object({ operational: z.object({ outcome: z.string().nullable() }) }).safeParse(attempt.report);
      return <details key={attempt.id} className="mt-3 rounded-lg border border-stone-200 p-3">
        <summary className="cursor-pointer text-sm"><strong>{contact.success ? contact.data.name : "Audio test"}</strong> · {attempt.mode === "internal" ? "Rehearsal" : "Pilot queue"} · {attempt.status}{attempt.review_required ? " · Needs review" : ""}<span className="ml-3 text-stone-500">{formatCallPhone(attempt.destination)}</span></summary>
        <p className="mt-2 text-xs text-stone-500">{new Date(attempt.created_at).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}{attempt.ended_reason ? ` · ${attempt.ended_reason}` : ""}{operational.success && operational.data.operational.outcome ? ` · ${operational.data.operational.outcome.replaceAll("_", " ")}` : ""}</p>
        {actions.error && <p className="mt-2 text-sm text-amber-700">Follow-up requests could not be loaded. Refresh before taking action.</p>}
        {records.success && records.data.filter(action => action.attempt_id === attempt.id).map(action => <div key={action.id} className="mt-2 rounded-md bg-stone-50 p-3 text-sm"><strong>{action.kind.replaceAll("_", " ")}</strong> · {action.status}<p className="mt-1 whitespace-pre-wrap text-stone-600">{typeof action.details.reason === "string" ? action.details.reason : "Review the saved action details."}</p>{typeof action.details.expressed_words === "string" && <p className="mt-1 text-stone-500">Prospect words: {action.details.expressed_words}</p>}{typeof action.details.start === "string" && <p className="mt-1 text-stone-600">Requested callback: {action.details.start} · {typeof action.details.timezone === "string" ? action.details.timezone : "Timezone needs review"}</p>}</div>)}
        <details className="mt-3 text-sm"><summary className="cursor-pointer text-stone-600">Email context and conversation</summary>
          <p className="mt-2 text-stone-600">{typeof attempt.context_snapshot.company_name === "string" ? attempt.context_snapshot.company_name : "Internal audio test"}</p>
          {typeof attempt.context_snapshot.email_sent_at === "string" && <p className="mt-1 text-xs text-stone-500">Email sent {new Date(attempt.context_snapshot.email_sent_at).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}</p>}
          {typeof attempt.context_snapshot.email_body === "string" && <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-sm">{attempt.context_snapshot.email_body}</p>}
          <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-sm">{z.object({ transcript: z.string() }).safeParse(attempt.report).success ? z.object({ transcript: z.string() }).parse(attempt.report).transcript || "No conversation transcript yet." : "No conversation transcript yet."}</p>
        </details>
      </details>;
    })}
  </details>;
}
