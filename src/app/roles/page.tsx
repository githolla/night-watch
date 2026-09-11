import Link from "next/link";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { FAMILY_LABEL, type JobFamily } from "@/lib/job-sweep/classify";
import { admin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = { family?: string; q?: string; page?: string; all?: string };

/** Whole days since a YYYY-MM-DD date; kept out of the component so rendering stays pure. */
function ageInDays(date: string) {
  return Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 86_400_000));
}
const pageSize = 100;

/** Every open role the sweep has found in a target family, across the whole list. */
export default async function RolesPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const params = await searchParams;
  const db = admin();
  const family = params.family && params.family in FAMILY_LABEL ? (params.family as JobFamily) : "";
  const query = params.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const showAll = params.all === "1";

  let rows = db
    .from("job_postings")
    .select("id,title,url,location,department,family,source,posted_at,first_seen_at,last_seen_at,salary_max,accounts!inner(name,domain)", { count: "exact" })
    .eq("active", true)
    .order("first_seen_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  rows = showAll ? rows : rows.not("family", "is", null);
  if (family) rows = rows.eq("family", family);
  if (query) rows = rows.or(`title.ilike.%${query.replace(/[%,]/g, " ")}%,accounts.name.ilike.%${query.replace(/[%,]/g, " ")}%`);

  const [{ data, count, error }, { data: familyRows }, { count: totalActive }] = await Promise.all([
    rows,
    db.from("job_postings").select("family").eq("active", true).not("family", "is", null).limit(10000),
    db.from("job_postings").select("*", { count: "exact", head: true }).eq("active", true),
  ]);
  if (error) throw error;
  const byFamily = new Map<string, number>();
  for (const row of familyRows ?? []) byFamily.set(row.family as string, (byFamily.get(row.family as string) ?? 0) + 1);
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const href = (next: Partial<Params>) => {
    const search = new URLSearchParams();
    const merged = { ...params, ...next };
    if (merged.family) search.set("family", merged.family);
    if (merged.q) search.set("q", merged.q);
    if (merged.all) search.set("all", merged.all);
    if (merged.page && merged.page !== "1") search.set("page", merged.page);
    const string = search.toString();
    return `/roles${string ? `?${string}` : ""}`;
  };

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <section className="targets-head">
        <div><span className="eyebrow">Open roles</span><h1>Every role Nine-67 could do instead of the hire.</h1><p>Read directly from careers pages, job boards, sitemaps and structured data by the sweep. Titles are matched to the target job families by rule; the whole list is re-read daily.</p></div>
        <div className="targets-head-count"><span>TARGET ROLES OPEN</span><strong>{(familyRows?.length ?? 0).toLocaleString()}</strong><small>{(totalActive ?? 0).toLocaleString()} postings read in total</small></div>
      </section>

      <nav className="family-strip" aria-label="Job families">
        <Link href={href({ family: "", page: "1" })} className={!family ? "active" : ""}><strong>{(familyRows?.length ?? 0).toLocaleString()}</strong><span>ALL FAMILIES</span></Link>
        {(Object.keys(FAMILY_LABEL) as JobFamily[]).map((key) => (
          <Link key={key} href={href({ family: key, page: "1" })} className={family === key ? "active" : ""}><strong>{(byFamily.get(key) ?? 0).toLocaleString()}</strong><span>{FAMILY_LABEL[key].toUpperCase()}</span></Link>
        ))}
      </nav>

      <form className="target-filters" action="/roles">
        {family && <input type="hidden" name="family" value={family} />}
        <label><span>Search</span><input name="q" defaultValue={query} placeholder="Title or company" /></label>
        <label><span>Show</span><select name="all" defaultValue={showAll ? "1" : ""}><option value="">Target families only</option><option value="1">Every posting read</option></select></label>
        <button className="btn primary" type="submit">Apply</button>
        {(query || family || showAll) && <Link href="/roles">Clear</Link>}
      </form>

      <section className="target-results">
        <header><div><span className="eyebrow">Postings{family ? ` · ${FAMILY_LABEL[family]}` : ""}</span><h2>{total.toLocaleString()} roles</h2></div><span>PAGE {page} / {totalPages}</span></header>
        <div className="target-table-wrap"><table className="target-directory-table roles-table"><thead><tr><th>Company</th><th>Role</th><th>Family</th><th>Where</th><th>Seen</th><th>Source</th></tr></thead><tbody>
          {(data ?? []).map((row) => {
            const account = row.accounts as unknown as { name: string; domain: string };
            const posted = row.posted_at ?? (row.first_seen_at as string).slice(0, 10);
            const days = ageInDays(posted);
            return <tr key={row.id}>
              <td><strong>{account.name}</strong><small>{account.domain}</small></td>
              <td><a href={row.url} target="_blank" rel="noreferrer"><strong>{row.title}</strong></a>{row.department && <small>{row.department}</small>}{row.salary_max && <small>up to ${Number(row.salary_max).toLocaleString()}</small>}</td>
              <td><span className={`status-chip ${row.family ? "ok" : "queued"}`}>{row.family ? FAMILY_LABEL[row.family as JobFamily] : "Other"}</span></td>
              <td><span>{row.location ?? "—"}</span></td>
              <td><span>{row.posted_at ? "Posted" : "First seen"} {posted}</span><small>{days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}</small></td>
              <td><span className="roles-source">{String(row.source ?? "careers").replace("_", " ")}</span></td>
            </tr>;
          })}
          {!data?.length && <tr><td colSpan={6}><em>No roles yet. Run the careers sweep from the desk.</em></td></tr>}
        </tbody></table></div>
        <nav className="target-pagination" aria-label="Role pages">
          {page > 1 ? <Link href={href({ page: String(page - 1) })}>← Previous</Link> : <span />}
          <span>{total ? ((page - 1) * pageSize + 1).toLocaleString() : 0}–{Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()}</span>
          {page < totalPages ? <Link href={href({ page: String(page + 1) })}>Next →</Link> : <span />}
        </nav>
      </section>
    </main>
  </div>;
}
