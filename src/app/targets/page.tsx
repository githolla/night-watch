import Link from "next/link";
import { Header } from "@/components/Header";
import { TargetAccountsPanel } from "@/components/TargetAccountsPanel";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { targetAccounts } from "@/lib/target-accounts";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = { q?: string; industry?: string; ownership?: string; research?: string; page?: string };
const researchFilters: Record<string, string> = { never: "Never researched", researched: "Researched", quiet: "Checked, no signal", signal: "Signals found" };
const pageSize = 50;

export default async function TargetsPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const params = await searchParams;
  const query = params.q?.trim().toLowerCase() ?? "";
  const industry = params.industry ?? "";
  const ownership = params.ownership ?? "";
  const research = params.research && params.research in researchFilters ? params.research : "";
  const db = admin();
  // Research state lives in the database; the directory itself is the static target file.
  const [{ data: liveAccounts }, { data: signalRows }] = await Promise.all([
    db.from("accounts").select("domain,status,last_scouted_at").not("domain", "like", "%.example").limit(5000),
    research === "quiet" || research === "signal" ? db.from("signals").select("account_id,accounts(domain)").limit(5000) : Promise.resolve({ data: [] as Array<{ account_id: string; accounts: unknown }> }),
  ]);
  const liveByDomain = new Map((liveAccounts ?? []).map((account) => [account.domain, account]));
  const signalDomains = new Set((signalRows ?? []).map((row) => (row.accounts as unknown as { domain: string } | null)?.domain).filter(Boolean));
  const matchesResearch = (domain: string) => {
    if (!research) return true;
    const live = liveByDomain.get(domain);
    const researched = Boolean(live?.last_scouted_at);
    if (research === "never") return !researched;
    if (research === "researched") return researched;
    if (research === "quiet") return researched && !signalDomains.has(domain);
    return signalDomains.has(domain);
  };
  const filtered = targetAccounts.filter((account) =>
    (!query || [account.name, account.domain, account.hqCity, account.hqState, account.aiSignal].some((value) => value.toLowerCase().includes(query))) &&
    (!industry || account.vertical === industry) &&
    (!ownership || account.ownership === ownership) &&
    matchesResearch(account.domain),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const activeCount = (liveAccounts ?? []).filter((account) => account.status === "active").length;
  const industries = [...new Set(targetAccounts.map((account) => account.vertical))].sort();
  const ownerships = [...new Set(targetAccounts.map((account) => account.ownership))].sort();

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <section className="targets-head">
        <div><span className="eyebrow">Target universe</span><h1>Every company Night Watch follows.</h1><p>Browse the complete $50M+ list, see what has been researched, and narrow it by sector or ownership.</p></div>
        <div className="targets-head-count"><span>SUPPLIED LIST</span><strong>{targetAccounts.length.toLocaleString()}</strong><small>{industries.length} industries · {ownerships.length} ownership types</small></div>
      </section>

      <TargetAccountsPanel initialCount={activeCount} targetTotal={targetAccounts.length} />

      <form className="target-filters" action="/targets">
        <label><span>Search</span><input name="q" defaultValue={params.q} placeholder="Company, domain, city, or AI signal" /></label>
        <label><span>Industry</span><select name="industry" defaultValue={industry}><option value="">All industries</option>{industries.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Ownership</span><select name="ownership" defaultValue={ownership}><option value="">All ownership</option>{ownerships.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Research</span><select name="research" defaultValue={research}><option value="">Any state</option>{Object.entries(researchFilters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="btn primary" type="submit">Apply filters</button>
        {(query || industry || ownership || research) && <Link href="/targets">Clear</Link>}
      </form>

      <section className="target-results">
        <header><div><span className="eyebrow">Company directory{research ? ` · ${researchFilters[research]}` : ""}</span><h2>{filtered.length.toLocaleString()} companies</h2></div><span>PAGE {page} / {totalPages}</span></header>
        <div className="target-table-wrap"><table className="target-directory-table"><thead><tr><th>Company</th><th>Profile</th><th>Revenue</th><th>Likely buyers</th><th>Research status</th></tr></thead><tbody>{visible.map((account) => {
          const live = liveByDomain.get(account.domain);
          return <tr key={account.domain}>
            <td><strong>{account.name}</strong><a href={`https://${account.domain}`} target="_blank" rel="noreferrer">{account.domain} ↗</a><small>{account.hqCity}, {account.hqState}</small></td>
            <td><span>{account.vertical}</span><small>{account.subSegment}</small><em>{account.ownership}{account.peSponsor ? ` · ${account.peSponsor}` : ""}</em></td>
            <td><strong>{account.revenueEstimateUsdM ? `$${account.revenueEstimateUsdM.toLocaleString()}M` : account.revenueBand}</strong><small>{account.revenueEstimateUsdM ? account.revenueBand : "Estimated band"}</small></td>
            <td><span>{account.targetTitles.slice(0, 3).join(" · ")}</span>{account.aiSignal && <small>{account.aiSignal}</small>}</td>
            <td><span className={`target-record-state ${live?.last_scouted_at ? "researched" : live ? "queued" : "unsynced"}`}>{live?.last_scouted_at ? "Researched" : live ? "Queued" : "Not synced"}</span><small>{live?.last_scouted_at ? new Date(live.last_scouted_at).toLocaleDateString() : live?.status ?? "—"}</small></td>
          </tr>;
        })}</tbody></table></div>
        <nav className="target-pagination" aria-label="Target pages">
          {page > 1 ? <Link href={pageHref(params, page - 1)}>← Previous</Link> : <span />}
          <span>{((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</span>
          {page < totalPages ? <Link href={pageHref(params, page + 1)}>Next →</Link> : <span />}
        </nav>
      </section>
    </main>
  </div>;
}

function pageHref(params: Params, page: number) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.industry) query.set("industry", params.industry);
  if (params.ownership) query.set("ownership", params.ownership);
  if (params.research) query.set("research", params.research);
  query.set("page", String(page));
  return `/targets?${query.toString()}`;
}
