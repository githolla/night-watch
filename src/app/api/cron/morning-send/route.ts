import { cronAuthorized } from "@/lib/auth";
import { runMorningSend } from "@/lib/morning-send";
import { finalizeOpenLists, preparePendingRows } from "@/lib/nightly-list-builder";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 300;

/** Announces and auto-sends the morning list; vercel.json runs it every ten minutes through the morning. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json({ seats: await runMorningSend(admin(), { finalizeOpenLists, preparePendingRows }) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Morning send failed" }, { status: 500 });
  }
}
