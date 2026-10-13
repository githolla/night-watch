import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { PageHead } from "@/components/PageHead";
import { LIST_BUILDERS, buildersForNight, revenueLane } from "@/lib/list-builders";
import { REVENUE_BAND_TEXT } from "@/lib/list-sectors";
import { localParts } from "@/lib/local-time";
export const dynamic = "force-dynamic";
async function builderSnapshot() {
  const date = localParts().date;
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const result = await admin().from("list_candidates").select("revenue_usd_m,status").in("status", ["new", "reserve"]).limit(5000);
  return { date, active: buildersForNight(day).map((builder) => builder.id as string), counts: result.error ? null : (result.data ?? []).reduce<Record<string, number>>((counts, row) => { const lane = revenueLane(typeof row.revenue_usd_m === "number" ? row.revenue_usd_m : null); counts[lane] = (counts[lane] ?? 0) + 1; return counts; }, {}) };
}
export default async function BuildersPage() {
  await requireUser(); const snapshot = await builderSnapshot();
  return <div className="shell"><main className="targets-page"><PageHead title="Intelligent list builders">Operating companies from {REVENUE_BAND_TEXT}, selected by evidence of useful work rather than size alone.</PageHead><div className="reddit-desk"><section className="card"><h2>How the nightly mix works</h2><p>The baseline revenue builder runs alongside a rotating signal builder. Empty sourcing attempts advance the signal strategy. Research rotates through core, growth and larger-company revenue segments while retaining each segment’s priority order.</p><p>Current sourcing plan for {snapshot.date}. The next list can use a different strategy as its date and retries change.</p>{snapshot.counts && <p>Waiting or reserved: {snapshot.counts.core ?? 0} at $10M-$100M · {snapshot.counts.growth ?? 0} at $100M-$250M · {snapshot.counts.upper_midmarket ?? 0} at $250M-$1B · {snapshot.counts.unknown ?? 0} requiring size research. Counts are a bounded snapshot.</p>}<p>Larger-company research prioritizes a division, regional or functional operating leader and a specific workflow. Revenue must belong to the exact company being targeted.</p><div className="reddit-actions"><Link className="btn-secondary" href="/discovery">Review source signals</Link><Link className="btn-secondary" href="/outreach">Open company lists</Link></div></section>{LIST_BUILDERS.map((builder) => <section className="card" key={builder.id}><h2>{builder.name}{snapshot.active.includes(builder.id) ? " · In current sourcing plan" : ""}</h2><p>{builder.focus}</p><p><b>Evidence required:</b> {builder.proof}</p><p><b>Buyer to investigate:</b> {builder.buyer}</p><p><b>Signal:</b> {builder.signal}{builder.windowDays ? ` · within ${builder.windowDays} days` : ""}</p></section>)}<section className="card"><h2>Quality and sending checks</h2><p>Every candidate still goes through company and entity confirmation, evidence-based AI fit, current buyer research, suppression checks and mailbox verification. Unknown revenue does not become reported revenue. Discovery records supply research leads; they are not accepted as proof without checking. Search limits, nightly budgets and send caps are unchanged.</p></section></div></main></div>;
}
