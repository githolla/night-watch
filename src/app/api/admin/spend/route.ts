import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 30;

const SINCE = { today: 0, week: 7, month: 30 } as const;

/**
 * What Night Watch has actually spent, from every place a cost is written down: the research pipeline,
 * the deep analysis, and the three routes that until now recorded nothing.
 *
 * Returns `tracked: false` for the api_spend half when supabase/repair/0024_api_spend.sql has not been
 * applied, so the panel can say "this part isn't being recorded yet" rather than quietly reporting a low
 * number as if it were the whole bill — which is exactly how $59 went missing.
 */
export async function GET() {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const db = admin();
    const startOf = (days: number) => {
      const date = new Date();
      if (days === 0) date.setHours(0, 0, 0, 0); else date.setDate(date.getDate() - days);
      return date.toISOString();
    };

    const windows = await Promise.all((Object.keys(SINCE) as Array<keyof typeof SINCE>).map(async (key) => {
      const since = startOf(SINCE[key]);
      const [research, analysis, direct] = await Promise.all([
        db.from("run_accounts").select("cost_usd").gte("started_at", since),
        db.from("accounts").select("analysis_cost_usd").gte("analysis_at", since),
        db.from("api_spend").select("source,cost_usd").gte("created_at", since),
      ]);
      const sum = (rows: Array<Record<string, unknown>> | null, column: string) =>
        (rows ?? []).reduce((total, row) => total + Number(row[column] ?? 0), 0);

      const bySource: Record<string, number> = {
        research: sum(research.data, "cost_usd"),
        analysis: sum(analysis.data, "analysis_cost_usd"),
      };
      for (const row of (direct.data ?? []) as Array<{ source: string; cost_usd: number }>) {
        bySource[row.source] = (bySource[row.source] ?? 0) + Number(row.cost_usd ?? 0);
      }
      const total = Object.values(bySource).reduce((a, b) => a + b, 0);
      return [key, {
        total: Number(total.toFixed(2)),
        bySource: Object.fromEntries(Object.entries(bySource).filter(([, value]) => value > 0).map(([k, v]) => [k, Number(v.toFixed(2))])),
        // A missing table is the untracked case, not an outage.
        tracked: !direct.error,
      }] as const;
    }));

    return Response.json(Object.fromEntries(windows));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read spend" }, { status: 400 });
  }
}
