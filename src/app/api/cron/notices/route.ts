import { cronAuthorized } from "@/lib/auth";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { runSeatNotices } from "@/lib/seat-notices";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 120;

/** The morning heads-up, the recap and the Friday results note; vercel.json runs it every ten minutes in the day. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    // Sector and size in the notes come from the list rows.
    await loadNightlyLists(admin()).catch(() => undefined);
    return Response.json({ notices: await runSeatNotices(admin()) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Notices failed" }, { status: 500 });
  }
}
