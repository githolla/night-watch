import Link from "next/link";
import { CompanyRows, type CompanyRow } from "@/components/CompanyRows";
import { FilterForm } from "@/components/FilterForm";
import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { requireUser } from "@/lib/auth";
import { isOutreachStage, type OutreachStage } from "@/lib/outreach";
import { pendingMigrations } from "@/lib/schema-check";
import { admin } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { syncTargetAccounts, targetsNeedSync } from "@/lib/sync-targets";
import { targetAccounts, TIER_DEFINITION, type TargetTier } from "@/lib/target-accounts";
import { daysAgoIso } from "@/lib/time";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = { q?: string; industry?: string; show?: string; sort?: string; page?: string; tier?: string };
type LiveAccount = { id: string; domain: string; status: string; tier: string | null; outreach: boolean; outreach_manual: boolean | null; outreach_stage: string | null; outreach_owner: string | null; last_scouted_at: string | null; careers_status: string | null; intel_score: number | null; open_target_roles: number | null; ai_posts: number | null; contacts: number | null; verified_emails: number | null; last_change_at: string | null };
const PAGE_SIZE = 50;
const SHOW: Record<string, string> = { "": "Everything", hiring: "Hiring target roles", posts: "Posting about AI", contacts: "Has people on file", changed: "Changed this week", drafted: "Draft ready", unscanned: "Not scanned yet", quiet: "Scanned, nothing found" };
const TABS: Array<{ value: string; label: string; test: (row: CompanyRow) => boolean }> = [
  { value: "", label: "All", test: () => true },
  { value: "list", label: "On the reach-out list", test: (row) => row.outreach },
  { value: "A1", label: "A1", test: (row) => row.tier === "A1" },
  { value: "A2", label: "A2", test: (row) => row.tier === "A2" },
  { value: "hold", label: "Held (B and C)", test: (row) => (row.tier === "B" || row.tier === "C") && !row.outreach },
  { value: "removed", label: "Removed", test: (row) => row.tier === "removed" },
];

/** Every company on the file: see what was found, and put companies on or off the reach-out list. */
export default async function TargetsPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const db = admin();
  const pending = await pendingMigrations(db);
  if (pending.length) return <MigrationRequired pending={pending} />;
  if (await targetsNeedSync(db)) await syncTargetAccounts(db);
  const params = await searchParams;
  const query = params.q?.trim().toLowerCase() ?? "";
  const industry = params.industry ?? "";
  const show = params.show && params.show in SHOW ? params.show : "";
  const tab = TABS.find((item) => item.value === (params.tier ?? "")) ?? TABS[0];
  const sort = params.sort === "name" ? "name" : params.sort === "change" ? "change" : "intel";

  const [live, cardRows] = await Promise.all([
    fetchAll<LiveAccount>((from, to) => db.from("accounts").select("id,domain,status,tier,outreach,outreach_manual,outreach_stage,outreach_owner,last_scouted_at,careers_status,intel_score,open_target_roles,ai_posts,contacts,verified_emails,last_change_at").not("domain", "like", "%.example").range(from, to)),
    fetchAll<{ account_id: string }>((from, to) => db.from("cards").select("account_id").in("status", ["new", "approved", "edited", "snoozed"]).range(from, to)),
  ]);
  const liveByDomain = new Map(live.map((account) => [account.domain, account]));
  const drafts = new Map<string, number>();
  for (const card of cardRows) drafts.set(card.account_id, (drafts.get(card.account_id) ?? 0) + 1);
  const weekAgo = Date.parse(daysAgoIso(7));

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
  const filtered = all.filter((row) => tab.test(row) && matchesShow(row) && (!industry || row.industry === industry) &&
    (!query || [row.name, row.domain, row.industry, row.subSegment, row.hq, row.owner, row.dropReason].some((value) => value.toLowerCase().includes(query))));
  filtered.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "change" ? Date.parse(b.lastChange ?? "1970-01-01") - Date.parse(a.lastChange ?? "1970-01-01") || b.intel - a.intel : b.intel - a.intel || Date.parse(b.lastChange ?? "1970-01-01") - Date.parse(a.lastChange ?? "1970-01-01") || a.name.localeCompare(b.name));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const industries = [...new Set(targetAccounts.map((account) => account.vertical))].sort();
  const href = (patch: Partial<Params>) => {
    const next = new URLSearchParams();
    const merged = { ...params, ...patch };
    for (const key of ["q", "industry", "show", "sort", "tier", "page"] as const) if (merged[key]) next.set(key, merged[key] as string);
    return `/targets${next.toString() ? `?${next}` : ""}`;
  };

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <header className="page-head">
        <div><h1>All companies</h1><p>{all.length.toLocaleString()} on the file. {counts.list} on the reach-out list get scanned and drafted; {counts.hold} held are swept only when asked; {counts.removed} removed by the cut. Click a company for everything on file, or use the switch to put it on or off the list.</p></div>
      </header>

      <section className="stat-row">
        {TABS.slice(1).map((item) => <Link key={item.value} href={href({ tier: item.value, page: undefined })} className={`stat ${tab.value === item.value ? "is-active" : ""}`} title={item.value === "A1" || item.value === "A2" || item.value === "removed" ? TIER_DEFINITION[item.value as TargetTier] : item.value === "hold" ? `${TIER_DEFINITION.B} / ${TIER_DEFINITION.C}` : undefined}><span>{item.label}</span><strong>{counts[item.value].toLocaleString()}</strong></Link>)}
      </section>

      <section className="card">
        <div className="tabs-row">
          <nav className="tabs" aria-label="Tiers">{TABS.map((item) => <Link key={item.value} href={href({ tier: item.value || undefined, page: undefined })} className={tab.value === item.value ? "is-active" : ""}>{item.label}<b>{counts[item.value].toLocaleString()}</b></Link>)}</nav>
          <FilterForm action="/targets" className="toolbar">
            <input type="hidden" name="tier" value={tab.value} />
            <input name="q" defaultValue={params.q} placeholder="Search" aria-label="Search" />
            <select name="industry" defaultValue={industry} aria-label="Industry"><option value="">All industries</option>{industries.map((item) => <option key={item}>{item}</option>)}</select>
            <select name="show" defaultValue={show} aria-label="Show">{Object.entries(SHOW).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select name="sort" defaultValue={sort} aria-label="Sort"><option value="intel">Most found first</option><option value="change">Recently changed</option><option value="name">A to Z</option></select>
            {(query || industry || show || params.sort) && <Link href={href({ q: undefined, industry: undefined, show: undefined, sort: undefined, page: undefined })} className="btn-link">Clear</Link>}
          </FilterForm>
        </div>
        <CompanyRows rows={visible} />
        <footer className="table-foot">
          <span>{filtered.length ? ((page - 1) * PAGE_SIZE + 1).toLocaleString() : 0}–{Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</span>
          <div>{page > 1 && <Link href={href({ page: String(page - 1) })} className="btn-secondary">Previous</Link>}{page < totalPages && <Link href={href({ page: String(page + 1) })} className="btn-secondary">Next</Link>}</div>
        </footer>
      </section>
    </main>
  </div>;
}
