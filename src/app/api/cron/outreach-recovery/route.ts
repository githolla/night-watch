import { cronAuthorized } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { recoverSendQueue } from "@/lib/send-queue-recovery";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json(await recoverSendQueue(admin())); }
  catch (cause: unknown) { return Response.json({ error: cause instanceof Error ? cause.message : "Contact enrichment failed." }, { status: 500 }); }
}
