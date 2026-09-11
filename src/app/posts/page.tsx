import Link from "next/link";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = { q?: string; page?: string };
const pageSize = 60;

/** Every public post the sweep found by someone at a target company about AI or automation in their own work. */
export default async function PostsPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const params = await searchParams;
  const db = admin();
  const query = params.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const safe = query.replace(/[%,]/g, " ");

  let rows = db
    .from("public_posts")
    .select("id,author_name,author_title,url,platform,topic,excerpt,posted_at,created_at,person_id,accounts!inner(name,domain),people(level,email_status,linkedin_url)", { count: "exact" })
    .order("posted_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (query) rows = rows.or(`author_name.ilike.%${safe}%,excerpt.ilike.%${safe}%,topic.ilike.%${safe}%,accounts.name.ilike.%${safe}%`);
  const { data, count, error } = await rows;
  if (error) throw error;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const href = (nextPage: number) => `/posts?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(nextPage > 1 ? { page: String(nextPage) } : {}) }).toString()}`;

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <section className="targets-head">
        <div><span className="eyebrow">Public posts</span><h1>People at target companies talking about AI in their own work.</h1><p>Found by the sweep&apos;s posts scan: LinkedIn, X, blogs and talks by named people who work at these companies. A post by a manager or executive becomes a dossier with them as the person.</p></div>
        <div className="targets-head-count"><span>POSTS FOUND</span><strong>{total.toLocaleString()}</strong><small>Verbatim excerpts, linked to the original</small></div>
      </section>

      <form className="target-filters" action="/posts">
        <label><span>Search</span><input name="q" defaultValue={query} placeholder="Author, company, topic, or words in the post" /></label>
        <button className="btn primary" type="submit">Apply</button>
        {query && <Link href="/posts">Clear</Link>}
      </form>

      <section className="unqualified-sources posts-list">
        <header><div><span className="eyebrow">Newest first</span><h2>{total.toLocaleString()} posts</h2></div><span>PAGE {page} / {totalPages}</span></header>
        <div>
          {(data ?? []).map((post) => {
            const account = post.accounts as unknown as { name: string; domain: string };
            const person = post.people as unknown as { level: string; email_status: string; linkedin_url: string | null } | null;
            return <a key={post.id} href={post.url} target="_blank" rel="noreferrer" className="unqualified-source-card">
              <div className="source-card-meta"><span>{(post.platform || "post").toUpperCase()}{post.topic ? ` · ${post.topic}` : ""}</span><time>{post.posted_at ?? (post.created_at as string).slice(0, 10)}</time></div>
              <h3>{account.name}</h3>
              <div className="source-card-author"><strong>{post.author_name}</strong><span>{post.author_title || account.domain}</span></div>
              <blockquote>{post.excerpt}</blockquote>
              <footer><span>{person ? `${person.level === "owner" ? "Decision owner" : person.level === "influencer" ? "Influencer" : "Adjacent"} · ${person.email_status === "verified" ? "verified email" : person.linkedin_url ? "LinkedIn on file" : "no contact yet"}` : "Person not yet matched"}</span><b>Open the post ↗</b></footer>
            </a>;
          })}
          {!data?.length && <p className="coverage-note">No posts yet. Run the careers sweep from the desk; the posts scan runs inside it.</p>}
        </div>
        <nav className="target-pagination" aria-label="Post pages">
          {page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : <span />}
          <span>{total ? ((page - 1) * pageSize + 1).toLocaleString() : 0}–{Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()}</span>
          {page < totalPages ? <Link href={href(page + 1)}>Next →</Link> : <span />}
        </nav>
      </section>
    </main>
  </div>;
}
