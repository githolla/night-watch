import Link from "next/link";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { FilterForm } from "@/components/FilterForm";
import { Header } from "@/components/Header";
import { TargetAccountsPanel } from "@/components/TargetAccountsPanel";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { activeTargetAccounts, targetAccounts, TIER_LABEL, type TargetTier } from "@/lib/target-accounts";
import { daysAgoIso } from "@/lib/time";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = { q?: string; industry?: string; ownership?: string; research?: string; sort?: string; page?: string; tier?: string };
const researchFilters: Record<string, string> = { changed: "Changed this week", hiring: "Hiring in target roles", posts: "AI posts found", contacts: "Verified email on file", never: "Never researched", researched: "Researched", quiet: "Checked, no signal", signal: "Signals found", nocareers: "Careers page not found" };
type LiveAccount = { domain: string; status: string; last_scouted_at: string | null; careers_status: string | null; intel_score: number | null; open_target_roles: number | null; ai_posts: number | null; contacts: number | null; verified_emails: number | null; last_change_at: string | null };
const pageSize = 50;

export default async function TargetsPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  {
    const pending = await pendingMigrations(admin());
    if (pending.length) return <MigrationRequired pending={pending} />;
  }
  const params = await searchParams;
  const query = params.q?.trim().toLowerCase() ?? "";
  const industry = params.industry ?? "";
  const ownership = params.ownership ?? "";
  const tier = params.tier && params.tier in TIER_LABEL ? (params.tier as TargetTier) : params.tier === "A" || params.tier === "hold" ? params.tier : "";
  const research = params.research && params.research in researchFilters ? params.research : "";
  const db = admin();
  // Research state lives in the database; the directory itself is the static target file.
  const [liveAccounts, signalRows] = await Promise.all([
    fetchAll<LiveAccount>((from, to) => db.from("accounts").select("domain,status,last_scouted_at,careers_status,intel_score,open_target_roles,ai_posts,contacts,verified_emails,last_change_at").not("domain", "like", "%.example").range(from, to)),
    research === "quiet" || research === "signal" ? fetchAll<{ account_id: string; accounts: unknown }>((from, to) => db.from("signals").select("account_id,accounts(domain)").range(from, to)) : Promise.resolve([] as Array<{ account_id: string; accounts: unknown }>),
  ]);
  const liveByDomain = new Map(liveAccounts.map((account) => [account.domain, account]));
  const signalDomains = new Set(signalRows.map((row) => (row.accounts as unknown as { domain: string } | null)?.domain).filter(Boolean));
  const weekAgo = Date.parse(daysAgoIso(7));
  const hasIntel = liveAccounts.some((account) => (account.intel_score ?? 0) > 0);
  const sort = params.sort === "name" || (!hasIntel && !params.sort) ? "name" : "intel";
  const matchesResearch = (domain: string) => {
    if (!research) return true;
    const live = liveByDomain.get(domain);
    const researched = Boolean(live?.last_scouted_at);
    if (research === "never") return !researched;
    if (research === "researched") return researched;
    if (research === "quiet") return researched && !signalDomains.has(domain);
    if (research === "hiring") return (live?.open_target_roles ?? 0) > 0;
    if (research === "posts") return (live?.ai_posts ?? 0) > 0;
    if (research === "contacts") return (live?.verified_emails ?? 0) > 0;
    if (research === "changed") return Boolean(live?.last_change_at && Date.parse(live.last_change_at) >= weekAgo);
    if (research === "nocareers") return live?.careers_status === "none";
    return signalDomains.has(domain);
  };
  const filtered = targetAccounts.filter((account) =>
    (!query || [account.name, account.domain, account.hqCity, account.hqState, account.aiSignal].some((value) => value.toLowerCase().includes(query))) &&
    (!industry || account.vertical === industry) &&
    (!ownership || account.ownership === ownership) &&
    (!tier || (tier === "A" ? account.outreach : tier === "hold" ? account.tier === "B" || account.tier === "C" : account.tier === tier)) &&
    matchesResearch(account.domain),
  );
  if (sort === "intel") {
    filtered.sort((left, right) => {
      const a = liveByDomain.get(left.domain), b = liveByDomain.get(right.domain);
      return (b?.intel_score ?? 0) - (a?.intel_score ?? 0)
        || Date.parse(b?.last_change_at ?? "1970-01-01") - Date.parse(a?.last_change_at ?? "1970-01-01")
        || left.name.localeCompare(right.name);
    });
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const activeCount = liveAccounts.filter((account) => account.status === "active").length;
  const industries = [...new Set(targetAccounts.map((account) => account.vertical))].sort();
  const ownerships = [...new Set(targetAccounts.map((account) => account.ownership))].sort();

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <section className="targets-head has-hero">
        <div><span className="eyebrow">Target universe</span><h1>Every company on the file, tier by tier.</h1><p>The complete $50M+ list with the reach-out cut applied. Only Tier A is contacted; work that list on the <Link href="/outreach">Reach-out page</Link>. Browse here to see what has been found for anyone, held or removed included.</p></div>
        <div className="targets-head-count"><span>SUPPLIED LIST</span><strong>{targetAccounts.length.toLocaleString()}</strong><small>{industries.length} industries · {ownerships.length} ownership types</small></div>
      </section>

      <TargetAccountsPanel initialCount={activeCount} targetTotal={activeTargetAccounts.length} />

      <FilterForm action="/targets">
        <label><span>Search</span><input name="q" defaultValue={params.q} placeholder="Company, domain, city, or AI signal" /></label>
        <label><span>Industry</span><select name="industry" defaultValue={industry}><option value="">All industries</option>{industries.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Ownership</span><select name="ownership" defaultValue={ownership}><option value="">All ownership</option>{ownerships.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Tier</span><select name="tier" defaultValue={tier}><option value="">All tiers</option><option value="A">Reach-out list (A1 + A2)</option><option value="hold">Held (B + C)</option>{Object.entries(TIER_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Research</span><select name="research" defaultValue={research}><option value="">Any state</option>{Object.entries(researchFilters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Sort</span><select name="sort" defaultValue={sort}><option value="intel">Intelligence score</option><option value="name">Name</option></select></label>
        <button className="btn primary" type="submit">Search</button>
        {(query || industry || ownership || research || tier || params.sort) && <Link href="/targets">Clear</Link>}
      </FilterForm>

      <section className="target-results">
        <header><div><span className="eyebrow">Company directory{research ? ` · ${researchFilters[research]}` : ""}</span><h2>{filtered.length.toLocaleString()} companies</h2></div><span>PAGE {page} / {totalPages}</span></header>
        <div className="target-table-wrap"><table className="target-directory-table"><thead><tr><th>Company</th><th>Profile</th><th>Intelligence</th><th>Likely buyers</th><th>Research status</th></tr></thead><tbody>{visible.map((account) => {
          const live = liveByDomain.get(account.domain);
          return <tr key={account.domain}>
            <td><Link href={`/accounts/${account.domain}`}><strong>{account.name}</strong></Link><a href={`https://${account.domain}`} target="_blank" rel="noreferrer">{account.domain} ↗</a><small>{account.hqCity}, {account.hqState}</small><span className="outreach-chips"><span className={`tier-chip tier-${account.tier}`}>{account.tier === "removed" ? "removed" : account.tier}</span></span></td>
            <td><span>{account.vertical}</span><small>{account.subSegment}</small><em>{account.ownership}{account.peSponsor ? ` · ${account.peSponsor}` : ""}</em></td>
            <td className="intel-cell"><strong className={`intel-score ${(live?.intel_score ?? 0) >= 60 ? "is-hot" : (live?.intel_score ?? 0) >= 30 ? "is-warm" : ""}`}>{live?.intel_score ?? 0}</strong><small>{[live?.open_target_roles ? `${live.open_target_roles} roles` : null, live?.ai_posts ? `${live.ai_posts} posts` : null, live?.contacts ? `${live.contacts} contacts${live.verified_emails ? ` (${live.verified_emails} verified)` : ""}` : null].filter(Boolean).join(" · ") || "no data yet"}</small><small>{live?.last_change_at ? `changed ${new Date(live.last_change_at).toLocaleDateString()}` : account.revenueEstimateUsdM ? `$${account.revenueEstimateUsdM.toLocaleString()}M` : account.revenueBand}</small></td>
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
  if (params.tier) query.set("tier", params.tier);
  if (params.sort) query.set("sort", params.sort);
  query.set("page", String(page));
  return `/targets?${query.toString()}`;
}
