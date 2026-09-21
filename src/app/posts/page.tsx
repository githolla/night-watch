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

type Params = { q?: string; page?: string; since?: string };
const pageSize = 60;

/** Every public post the sweep found by someone at a target company about AI or automation in their own work. */
export default async function PostsPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  {
    const pending = await pendingMigrations(admin());
    if (pending.length) return <MigrationRequired pending={pending} />;
  }
  const params = await searchParams;
  const db = admin();
  const query = params.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  // Strip PostgREST or()-filter metacharacters: %/, split conditions, ()/* group and wildcard. Leaving them
  // in lets a search string break the filter grammar or inject extra conditions.
  const safe = query.replace(/[%,()*]/g, " ");
  const sinceDays = [1, 7, 30].includes(Number(params.since)) ? Number(params.since) : 0;

  let rows = db
    .from("public_posts")
    .select("id,author_name,author_title,url,platform,topic,excerpt,posted_at,created_at,person_id,accounts!inner(name,domain),people(level,email_status,linkedin_url)", { count: "exact" })
    .order("posted_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (query) rows = rows.or(`author_name.ilike.%${safe}%,excerpt.ilike.%${safe}%,topic.ilike.%${safe}%,accounts.name.ilike.%${safe}%`);
  if (sinceDays) rows = rows.gte("created_at", daysAgoIso(sinceDays));
  const { data, count, error } = await rows;
  if (error) throw error;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const href = (nextPage: number) => `/posts?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(sinceDays ? { since: String(sinceDays) } : {}), ...(nextPage > 1 ? { page: String(nextPage) } : {}) }).toString()}`;

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <header className="page-head briefing-head">
        <div><span className="overview-kick">Public posts</span><h1>Employee posts</h1><p>People at the target companies posting publicly about AI in their own work · {total.toLocaleString()} on file.</p></div>
      </header>

      <FilterForm action="/posts">
        <label><span>Search</span><input name="q" defaultValue={query} placeholder="Author, company, topic, or words in the post" /></label>
        <label><span>Found since</span><select name="since" defaultValue={sinceDays ? String(sinceDays) : ""}><option value="">Any time</option><option value="1">Yesterday</option><option value="7">This week</option><option value="30">This month</option></select></label>
        <button className="btn primary" type="submit">Apply</button>
        {(query || sinceDays) && <Link href="/posts">Clear</Link>}
      </FilterForm>

      <section className="target-results">
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Company</th><th>Post</th><th>Platform</th><th>Posted</th><th /></tr></thead><tbody>
          {(data ?? []).map((post) => {
            const account = post.accounts as unknown as { name: string; domain: string };
            return <RowLink as="tr" key={post.id} href={`/accounts/${account.domain}`}>
              <td><div className="cell-lead"><strong>{post.author_name}</strong><small>{post.author_title || "—"}</small></div></td>
              <td>{account.name}</td>
              <td className="cell-clamp">{post.excerpt}</td>
              <td className="cell-sub">{post.platform || "post"}{post.topic ? ` · ${post.topic}` : ""}</td>
              <td className="cell-time">{post.posted_at ?? (post.created_at as string).slice(0, 10)}</td>
              <td><a href={post.url} target="_blank" rel="noreferrer">Open ↗</a></td>
            </RowLink>;
          })}
          {!data?.length && <tr><td colSpan={6} className="cell-empty">{query || sinceDays ? "No posts match these filters." : "No posts yet. The posts scan runs inside the careers sweep."}</td></tr>}
        </tbody></table></div>
        <nav className="target-pagination" aria-label="Post pages">
          {page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : <span />}
          <span>{total ? ((page - 1) * pageSize + 1).toLocaleString() : 0}–{Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()}</span>
          {page < totalPages ? <Link href={href(page + 1)}>Next →</Link> : <span />}
        </nav>
      </section>
    </main>
  </div>;
}
