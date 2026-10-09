import { cronAuthorized } from "@/lib/auth";
import { runAddressSweep } from "@/lib/address-sweep";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 300;

/** Finds unconfirmed addresses on the companies' own sites, a few per run; vercel.json runs it every 20 minutes. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json({ searched: await runAddressSweep(admin()) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Address sweep failed" }, { status: 500 });
  }
}
