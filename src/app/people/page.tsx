import Link from "next/link";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { FilterForm } from "@/components/FilterForm";
import { Header } from "@/components/Header";
import { RowLink } from "@/components/RowLink";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { daysAgoIso } from "@/lib/time";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = { q?: string; level?: string; email?: string; page?: string; since?: string };
const pageSize = 100;

const LEVEL_LABEL: Record<string, string> = { owner: "Decision owner", influencer: "Influencer", adjacent: "Adjacent", unknown: "Unknown" };
const EMAIL_LABEL: Record<string, string> = { verified: "Verified", catch_all: "Catch-all", unverified: "Unverified", none: "None" };

/** Every person the sweep or a signal has put on file, with contact state. */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  {
    const pending = await pendingMigrations(admin());
    if (pending.length) return <MigrationRequired pending={pending} />;
  }
  const params = await searchParams;
  const db = admin();
  const query = params.q?.trim() ?? "";
  const level = params.level && params.level in LEVEL_LABEL ? params.level : "";
  const email = params.email && params.email in EMAIL_LABEL ? params.email : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const safe = query.replace(/[%,]/g, " ");
  const sinceDays = [1, 7, 30].includes(Number(params.since)) ? Number(params.since) : 0;

  let rows = db
    .from("people")
    .select("id,full_name,title,level,email,email_status,email_source,linkedin_url,source,enriched_at,created_at,accounts!inner(name,domain)", { count: "exact" })
    .eq("do_not_contact", false)
    .order("enriched_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (level) rows = rows.eq("level", level);
  if (email) rows = rows.eq("email_status", email);
  if (query) rows = rows.or(`full_name.ilike.%${safe}%,title.ilike.%${safe}%,accounts.name.ilike.%${safe}%`);
  if (sinceDays) rows = rows.gte("created_at", daysAgoIso(sinceDays));

  const [{ data, count, error }, { count: verified }, { count: withLinkedIn }] = await Promise.all([
    rows,
    db.from("people").select("*", { count: "exact", head: true }).eq("email_status", "verified"),
    db.from("people").select("*", { count: "exact", head: true }).not("linkedin_url", "is", null),
  ]);
  if (error) throw error;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const href = (next: Partial<Params>) => {
    const merged = { ...params, ...next };
    const search = new URLSearchParams();
    if (merged.q) search.set("q", merged.q);
    if (merged.level) search.set("level", merged.level);
    if (merged.email) search.set("email", merged.email);
    if (merged.since) search.set("since", merged.since);
    if (merged.page && merged.page !== "1") search.set("page", merged.page);
    const string = search.toString();
    return `/people${string ? `?${string}` : ""}`;
  };

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <section className="targets-head has-hero">
        <div><span className="eyebrow">People on file</span><h1>Who to contact, and how.</h1><p>The CEO from the target file, buyer-title matches from Apollo, post authors and signal owners, enriched with email and LinkedIn where available. Nothing is sent from here; the desk sends.</p></div>
        <div className="targets-head-count"><span>PEOPLE</span><strong>{total.toLocaleString()}</strong><small>{(verified ?? 0).toLocaleString()} verified emails · {(withLinkedIn ?? 0).toLocaleString()} LinkedIn profiles</small></div>
      </section>

      <FilterForm action="/people">
        <label><span>Search</span><input name="q" defaultValue={query} placeholder="Name, title, or company" /></label>
        <label><span>Level</span><select name="level" defaultValue={level}><option value="">Any level</option>{Object.entries(LEVEL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Email</span><select name="email" defaultValue={email}><option value="">Any state</option>{Object.entries(EMAIL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Added since</span><select name="since" defaultValue={sinceDays ? String(sinceDays) : ""}><option value="">Any time</option><option value="1">Yesterday</option><option value="7">This week</option><option value="30">This month</option></select></label>
        <button className="btn primary" type="submit">Apply</button>
        {(query || level || email || sinceDays) && <Link href="/people">Clear</Link>}
      </FilterForm>

      <section className="target-results">
        <header><div><span className="eyebrow">Contacts</span><h2>{total.toLocaleString()} people</h2></div><span>PAGE {page} / {totalPages}</span></header>
        <ol className="rank-list people-list">
          {(data ?? []).map((person) => {
            const account = person.accounts as unknown as { name: string; domain: string };
            const email = person.email as string | null;
            return <RowLink as="li" key={person.id} href={`/accounts/${account.domain}`}>
              <div className="rank-company"><strong>{person.full_name}</strong><small>{person.title}</small><span className="outreach-chips"><span className={`tier-chip ${person.level === "owner" ? "tier-A1" : person.level === "influencer" ? "tier-A2" : ""}`}>{LEVEL_LABEL[person.level as string] ?? person.level}</span></span></div>
              <div className="rank-why"><p>{account.name}</p><small>{email ? `${email} · ${person.email_source === "pattern" ? "built, unverified" : EMAIL_LABEL[person.email_status as string] ?? person.email_status}` : "no email on file"}{person.linkedin_url ? " · LinkedIn on file" : ""}</small></div>
              <div className="rank-status">{person.linkedin_url ? <a href={person.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a> : <span>—</span>}<small>{String(person.source ?? "signal").replace("_", " ")}{person.enriched_at ? ` · ${(person.enriched_at as string).slice(0, 10)}` : ""}</small></div>
              <span className="rank-go">→</span>
            </RowLink>;
          })}
          {!data?.length && <li className="outreach-empty">No people yet. The scan finds them on company sites, LinkedIn results and press as it runs.</li>}
        </ol>
        <nav className="target-pagination" aria-label="People pages">
          {page > 1 ? <Link href={href({ page: String(page - 1) })}>← Previous</Link> : <span />}
          <span>{total ? ((page - 1) * pageSize + 1).toLocaleString() : 0}–{Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()}</span>
          {page < totalPages ? <Link href={href({ page: String(page + 1) })}>Next →</Link> : <span />}
        </nav>
      </section>
    </main>
  </div>;
}
