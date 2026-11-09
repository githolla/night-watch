import type { SupabaseClient } from "@supabase/supabase-js";

export function voiceFailureDisposition(providerRequestStarted: boolean) {
  return providerRequestStarted ? "reconcile_provider" : "contact_only";
}

export async function holdVoicePreflight(db: SupabaseClient, id: string, reason: string) {
  const read = await db.from("voice_attempts").select("dispatched_at,context_snapshot").eq("id", id).eq("status", "creating").is("vapi_call_id", null).single();
  if (read.error) throw new Error("Could not verify the undialed reservation. Keep dispatch held for reconciliation.");
  const saved = await db.from("voice_attempts").update({
    status: "held", review_required: true, dispatched_at: null, ended_reason: reason.slice(0, 1000),
    context_snapshot: { ...read.data.context_snapshot, dispatch_enabled: false, preflight_failure: { at: new Date().toISOString(), reserved_at: read.data.dispatched_at, provider_request_started: false } },
  }).eq("id", id).eq("status", "creating").is("vapi_call_id", null).select("id");
  if (saved.error || !saved.data?.length) throw new Error("Could not hold the undialed reservation. Reconcile before further dispatch.");
}
