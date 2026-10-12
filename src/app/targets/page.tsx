import Link from "next/link";
import { CompanyRows, type CompanyRow } from "@/components/CompanyRows";
import { FilterForm } from "@/components/FilterForm";
import { AddCompany } from "@/components/AddCompany";
import { ToolDrawer } from "@/components/ToolDrawer";
import { MigrationRequired } from "@/components/MigrationRequired";
import { requireUser } from "@/lib/auth";
import { FIT, fitBreakdown, signalCounts, stageFunnel, topBy, type InsightRow } from "@/lib/company-insights";
import { isOutreachStage, STAGE_LABEL, STAGE_ORDER, type OutreachStage } from "@/lib/outreach";
import { pendingMigrations } from "@/lib/schema-check";
import { admin } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { syncTargetAccounts, targetsNeedSync } from "@/lib/sync-targets";
import { targetAccounts } from "@/lib/target-accounts";
import { daysAgoIso } from "@/lib/time";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = { q?: string; industry?: string; show?: string; sort?: string; page?: string; tier?: string; stage?: string; state?: string };
type LiveAccount = { id: string; domain: string; status: string; tier: string | null; outreach: boolean; outreach_manual: boolean | null; outreach_stage: string | null; outreach_owner: string | null; last_scouted_at: string | null; careers_status: string | null; intel_score: number | null; open_target_roles: number | null; ai_posts: number | null; contacts: number | null; verified_emails: number | null; last_change_at: string | null };
const PAGE_SIZE = 50;
const SHOW: Record<string, string> = { "": "Everything", hiring: "Hiring target roles", posts: "Posting about AI", contacts: "Has people on file", changed: "Changed this week", drafted: "Draft ready", unscanned: "Not scanned yet", quiet: "Scanned, nothing found" };
const TABS: Array<{ value: string; label: string; test: (row: CompanyRow) => boolean }> = [
  { value: "", label: "All companies", test: () => true },
  { value: "list", label: "Companies to email", test: (row) => row.outreach },
  ...Object.entries(FIT).map(([tier, fit]) => ({ value: tier, label: fit.label, test: (row: CompanyRow) => row.tier === tier })),
];

/** A short bar chart where each bar is a link: the whole file in light, the reach-out share in the accent. */
function BarList({ items, selected, link }: { items: Array<{ key: string; total: number; onList: number }>; selected: string; link: (key: string) => string }) {
  const top = Math.max(1, ...items.map((item) => item.total));
  return <ul className="ac-bars">{items.map((item) => (
    <li key={item.key}><Link href={link(item.key)} className={selected === item.key ? "is-on" : ""}>
      <span className="ac-bar-top"><span className="ac-bar-label">{item.key}</span><b>{item.total}</b></span>
      <span className="ac-bar"><span className="is-all" style={{ width: `${(item.total / top) * 100}%` }} /><span className="is-list" style={{ width: `${(item.onList / top) * 100}%` }} /></span>
    </Link></li>
  ))}</ul>;
}

/** Every company on the file: how good a fit they are, where outreach stands, and the table to act on them. */
export default async function TargetsPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  // Check the schema while sign-in is checked, instead of one round trip after it.
  const schemaCheck = pendingMigrations(admin()).catch(() => []);
  const me = await requireUser();
  const db = admin();
  const pending = await schemaCheck;
  if (pending.length) return <MigrationRequired pending={pending} />;
  if (await targetsNeedSync(db)) await syncTargetAccounts(db);
  const params = await searchParams;
  const query = params.q?.trim().toLowerCase() ?? "";
  const industry = params.industry ?? "";
  const show = params.show && params.show in SHOW ? params.show : "";
  const tab = TABS.find((item) => item.value === (params.tier ?? "")) ?? TABS[0];
  const sort = params.sort === "name" ? "name" : params.sort === "change" ? "change" : "intel";
  const stage = isOutreachStage(params.stage) ? params.stage : null;
  const state = params.state?.trim().toUpperCase() ?? "";

  const [live, cardRows] = await Promise.all([
    fetchAll<LiveAccount>((from, to) => db.from("accounts").select("id,domain,status,tier,outreach,outreach_manual,outreach_stage,outreach_owner,last_scouted_at,careers_status,intel_score,open_target_roles,ai_posts,contacts,verified_emails,last_change_at").not("domain", "like", "%.example").range(from, to)),
    fetchAll<{ account_id: string }>((from, to) => db.from("cards").select("account_id").in("status", ["new", "approved", "edited", "snoozed"]).range(from, to)),
  ]);
  const liveByDomain = new Map(live.map((account) => [account.domain, account]));
  const drafts = new Map<string, number>();
  for (const card of cardRows) drafts.set(card.account_id, (drafts.get(card.account_id) ?? 0) + 1);
  const weekAgo = Date.parse(daysAgoIso(7));

  const states = new Map(targetAccounts.map((target) => [target.domain, target.hqState]));
  const all: CompanyRow[] = targetAccounts.map((target) => {
    const account = liveByDomain.get(target.domain);
    const stage: OutreachStage = isOutreachStage(account?.outreach_stage) ? account.outreach_stage : "untouched";
    return {
      id: account?.id ?? null, domain: target.domain, name: target.name, industry: target.vertical, subSegment: target.subSegment, hq: [target.hqCity, target.hqState].filter(Boolean).join(", "),
      tier: account?.tier ?? target.tier, outreach: account?.outreach ?? target.outreach, manual: account?.outreach_manual !== null && account?.outreach_manual !== undefined,
      intel: account?.intel_score ?? 0, roles: account?.open_target_roles ?? 0, posts: account?.ai_posts ?? 0, contacts: account?.contacts ?? 0, verified: account?.verified_emails ?? 0,
      stage, owner: account?.outreach_owner ?? "", lastChange: account?.last_change_at ?? null, scanned: Boolean(account?.careers_status || account?.last_scouted_at), drafts: account ? drafts.get(account.id) ?? 0 : 0, dropReason: target.dropReason,
    };
  });
  const counts = Object.fromEntries(TABS.map((item) => [item.value, all.filter(item.test).length]));
  const matchesShow = (row: CompanyRow) => {
    if (show === "hiring") return row.roles > 0;
    if (show === "posts") return row.posts > 0;
    if (show === "contacts") return row.contacts > 0;
    if (show === "changed") return Boolean(row.lastChange && Date.parse(row.lastChange) >= weekAgo);
    if (show === "drafted") return row.drafts > 0;
    if (show === "unscanned") return !row.scanned;
    if (show === "quiet") return row.scanned && row.intel === 0;
    return true;
  };
  const filtered = all.filter((row) => tab.test(row) && matchesShow(row) && (!industry || row.industry === industry) && (!stage || (row.outreach && row.stage === stage)) && (!state || (states.get(row.domain) ?? "").toUpperCase() === state) &&
    (!query || [row.name, row.domain, row.industry, row.subSegment, row.hq, row.owner, row.dropReason].some((value) => value.toLowerCase().includes(query))));
  filtered.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "change" ? Date.parse(b.lastChange ?? "1970-01-01") - Date.parse(a.lastChange ?? "1970-01-01") || b.intel - a.intel : b.intel - a.intel || Date.parse(b.lastChange ?? "1970-01-01") - Date.parse(a.lastChange ?? "1970-01-01") || a.name.localeCompare(b.name));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const industries = [...new Set(targetAccounts.map((account) => account.vertical))].sort();
  const insight: InsightRow[] = all.map((row) => ({ tier: row.tier, outreach: row.outreach, stage: row.stage, industry: row.industry, state: states.get(row.domain) ?? "", roles: row.roles, posts: row.posts, contacts: row.contacts, verified: row.verified, changedThisWeek: Boolean(row.lastChange && Date.parse(row.lastChange) >= weekAgo) }));
  const fits = fitBreakdown(insight);
  const funnel = stageFunnel(insight, STAGE_ORDER).filter((item) => !["lost", "hold"].includes(item.stage));
  const funnelTop = Math.max(1, ...funnel.map((item) => item.count));
  const signals = signalCounts(insight);
  const topIndustries = topBy(insight, "industry");
  const topStates = topBy(insight, "state");
  const share = (n: number) => `${Math.max(n ? 1.5 : 0, (n / Math.max(1, all.length)) * 100)}%`;
  const href = (patch: Partial<Params>) => {
    const next = new URLSearchParams();
    const merged = { ...params, ...patch };
    for (const key of ["q", "industry", "show", "sort", "tier", "stage", "state", "page"] as const) if (merged[key]) next.set(key, merged[key] as string);
    return `/targets${next.toString() ? `?${next}` : ""}`;
  };

  const active: Array<{ label: string; clear: Partial<Params> }> = [];
  if (tab.value) active.push({ label: tab.label, clear: { tier: undefined } });
  if (stage) active.push({ label: `Stage: ${STAGE_LABEL[stage]}`, clear: { stage: undefined } });
  if (industry) active.push({ label: industry, clear: { industry: undefined } });
  if (state) active.push({ label: `Based in ${state}`, clear: { state: undefined } });
  if (show) active.push({ label: SHOW[show], clear: { show: undefined } });
  if (query) active.push({ label: `"${params.q}"`, clear: { q: undefined } });
  const signalLinks: Array<{ key: string; label: string; value: number }> = [
    { key: "hiring", label: "Hiring for target roles", value: signals.hiring },
    { key: "posts", label: "Posting about AI", value: signals.posts },
    { key: "contacts", label: "People on file", value: signals.contacts },
    { key: "changed", label: "Changed this week", value: signals.changed },
  ];
  return <div className="shell">
    <main className="targets-page ac-page">
      <header className="ac-head">
        <div>
          <h1>All companies</h1>
          <p><b>{all.length.toLocaleString()}</b> companies on file. <Link href={href({ tier: "list", page: undefined, stage: undefined })}><b>{counts.list.toLocaleString()}</b> are companies to email</Link>, which Night Watch scans and writes to each night.</p>
        </div>
        {me.role === "admin" && <ToolDrawer label="Add company" title="Target accounts">
          <AddCompany />
        </ToolDrawer>}
      </header>

      <section className="ac-card ac-fit" aria-label="How the file breaks down">
        <div className="ac-card-head"><h2>How good a fit they are</h2><p>Every company sorted by size and AI signal. Click a group to see it.</p></div>
        <div className="ac-stack" aria-hidden="true">{fits.map((item) => item.total > 0 && <Link key={item.key} href={href({ tier: item.key, page: undefined })} className={`is-${item.key} ${tab.value === item.key ? "is-on" : ""}`} style={{ width: share(item.total) }} tabIndex={-1} />)}</div>
        <ul className="ac-fit-list">
          {fits.map((item) => (
            <li key={item.key}><Link href={href({ tier: tab.value === item.key ? undefined : item.key, page: undefined })} className={tab.value === item.key ? "is-on" : ""}>
              <span className={`ac-swatch is-${item.key}`} aria-hidden="true" />
              <span className="ac-fit-text"><b>{FIT[item.key].label}</b><small>{FIT[item.key].meaning}</small></span>
              <span className="ac-fit-num"><b>{item.total.toLocaleString()}</b><small>{item.key === "removed" ? "not contacted" : `${item.onList.toLocaleString()} on the list`}</small></span>
            </Link></li>
          ))}
        </ul>
      </section>

      <div className="ac-grid">
        <section className="ac-card" aria-label="Reach-out progress">
          <div className="ac-card-head"><h2>Reach-out progress</h2><p>Where the {counts.list} companies on the list stand.</p></div>
          <ul className="ac-funnel">{funnel.map((item) => (
            <li key={item.stage}><Link href={href({ tier: "list", stage: stage === item.stage ? undefined : item.stage, page: undefined })} className={stage === item.stage ? "is-on" : ""}>
              <span className="ac-bar-top"><span className="ac-bar-label">{STAGE_LABEL[item.stage]}</span><b>{item.count}</b></span>
              <span className="ac-bar"><span className={`is-stage is-${item.stage}`} style={{ width: `${(item.count / funnelTop) * 100}%` }} /></span>
            </Link></li>
          ))}</ul>
        </section>
        <section className="ac-card" aria-label="Buying signals">
          <div className="ac-card-head"><h2>Signals worth a look</h2><p>What the nightly sweep has found so far.</p></div>
          <ul className="ac-signals">{signalLinks.map((item) => (
            <li key={item.key}><Link href={href({ show: show === item.key ? undefined : item.key, page: undefined })} className={show === item.key ? "is-on" : ""}><b>{item.value.toLocaleString()}</b><span>{item.label}</span></Link></li>
          ))}</ul>
          <p className="ac-note">{signals.verified.toLocaleString()} companies have a verified email on file.</p>
        </section>
        <section className="ac-card" aria-label="Top industries">
          <div className="ac-card-head"><h2>Top industries</h2><p><span className="ac-key is-list" /> to email <span className="ac-key is-all" /> on file</p></div>
          <BarList items={topIndustries} selected={industry} link={(key) => href({ industry: key, page: undefined })} />
        </section>
        <section className="ac-card" aria-label="Where they are based">
          <div className="ac-card-head"><h2>Where they are based</h2><p>Headquarters, by state.</p></div>
          <BarList items={topStates} selected={state} link={(key) => href({ state: key, page: undefined })} />
        </section>
      </div>

      <section className="card ac-table">
        <div className="ac-table-head">
          <div className="ac-showing">
            <h2>{filtered.length.toLocaleString()} {filtered.length === 1 ? "company" : "companies"}</h2>
            {active.length > 0 && <span className="ac-chips">{active.map((item) => <Link key={item.label} href={href({ ...item.clear, page: undefined })} className="ac-chip" title="Remove this filter">{item.label}<span aria-hidden="true">&times;</span></Link>)}<Link href="/targets" className="ac-clear">Clear all</Link></span>}
          </div>
          <FilterForm action="/targets" className="toolbar">
            {tab.value && <input type="hidden" name="tier" value={tab.value} />}
            {stage && <input type="hidden" name="stage" value={stage} />}
            {state && <input type="hidden" name="state" value={state} />}
            <input name="q" defaultValue={params.q} placeholder="Search companies" aria-label="Search" />
            <select name="industry" defaultValue={industry} aria-label="Industry"><option value="">All industries</option>{industries.map((item) => <option key={item}>{item}</option>)}</select>
            <select name="show" defaultValue={show} aria-label="Show">{Object.entries(SHOW).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select name="sort" defaultValue={sort} aria-label="Sort"><option value="intel">Most found first</option><option value="change">Recently changed</option><option value="name">A to Z</option></select>
          </FilterForm>
        </div>
        <CompanyRows rows={visible} />
        <footer className="table-foot">
          <span>{filtered.length ? ((page - 1) * PAGE_SIZE + 1).toLocaleString() : 0}&ndash;{Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</span>
          <div>{page > 1 && <Link href={href({ page: String(page - 1) })} className="btn-secondary">Previous</Link>}{page < totalPages && <Link href={href({ page: String(page + 1) })} className="btn-secondary">Next</Link>}</div>
        </footer>
      </section>
    </main>
  </div>;
}
