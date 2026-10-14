import { cronAuthorized } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { loadSendPlan } from "@/lib/send-plan-loader";
import { recoverSendQueue } from "@/lib/send-queue-recovery";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { const db = admin(); const result = new URL(request.url).searchParams.get("mode") === "status" ? {} : await recoverSendQueue(db); const seats = await Promise.all((["josh", "suuchi"] as const).map(async owner => ({ owner, plan: await loadSendPlan(db, owner) }))); return Response.json({ ...result, seats }); }
  catch (cause: unknown) { return Response.json({ error: cause instanceof Error ? cause.message : "Contact enrichment failed." }, { status: 500 }); }
}
