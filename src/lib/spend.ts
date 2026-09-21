import { admin } from "./supabase/admin.ts";

/**
 * Write down what a model call cost.
 *
 * Best-effort by design, and on two counts. It never throws, because a failure to record a cost must never
 * fail the work the user actually asked for. And it tolerates the table not existing, so the app keeps
 * running before supabase/repair/0024_api_spend.sql has been applied — applying that file is what switches
 * the Spend panel on, with no deploy.
 */
export async function recordSpend(source: string, model: string | null, costUsd: number, detail: Record<string, unknown> = {}) {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  try {
    await admin().from("api_spend").insert({ source, model, cost_usd: Number(costUsd.toFixed(6)), detail });
  } catch { /* recording is never worth failing a request over */ }
}

/**
 * A recorder that adds up the cost of several calls and writes one row at the end — one line per user
 * action ("this rewrite cost $2.60"), rather than one per underlying model call.
 */
export function spendTally(source: string, detail: Record<string, unknown> = {}) {
  let total = 0;
  let model: string | null = null;
  return {
    record: (costUsd: number) => { if (Number.isFinite(costUsd)) total += costUsd; },
    setModel: (value: string | null) => { model = value; },
    get total() { return total; },
    flush: async (extra: Record<string, unknown> = {}) => {
      await recordSpend(source, model, total, { ...detail, ...extra });
      return total;
    },
  };
}
