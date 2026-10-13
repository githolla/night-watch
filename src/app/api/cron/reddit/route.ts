import { cronAuthorized } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { runReddit } from "@/lib/reddit/run";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return Response.json(await runReddit(admin(), `nightly:${date}`));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Discovery failed." }, { status: 500 }); }
}
