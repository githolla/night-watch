import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "./supabase/fetch-all.ts";

/** Slow-moving coverage aggregates for the desk header. Computing these means scanning the whole
 *  signals and job_postings tables, so cache them per server for a few minutes — the numbers only
 *  change when a nightly run adds rows, and the desk's actionable data is queried fresh every load. */
export type DeskCoverage = { signalAccounts: number; hiringCompanies: number; targetRolesOpen: number };

let cached: { at: number; value: DeskCoverage } | null = null;
const TTL_MS = 5 * 60_000;

export async function deskCoverage(db: SupabaseClient, now = Date.now()): Promise<DeskCoverage> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  const [signalRows, hiringRows] = await Promise.all([
    fetchAll<{ account_id: string }>((from, to) => db.from("signals").select("account_id").range(from, to)),
    fetchAll<{ account_id: string }>((from, to) => db.from("job_postings").select("account_id").eq("active", true).not("family", "is", null).range(from, to)),
  ]);
  const value: DeskCoverage = {
    signalAccounts: new Set(signalRows.map((row) => row.account_id)).size,
    hiringCompanies: new Set(hiringRows.map((row) => row.account_id)).size,
    targetRolesOpen: hiringRows.length,
  };
  cached = { at: now, value };
  return value;
}
