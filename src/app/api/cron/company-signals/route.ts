import { cronAuthorized } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { runDiscovery } from "@/lib/discovery/run";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const now = Date.now();
    return Response.json(await runDiscovery(admin(), `company-signals:${Math.floor(now / (20 * 60000))}`, now, { companyOnly: true }));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Company monitoring failed." }, { status: 500 }); }
}
