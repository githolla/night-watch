import Link from "next/link";
import { PageHead } from "@/components/PageHead";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { filterImportedProspects, importedProspects, PROSPECT_IMPORT } from "@/lib/prospect-import";

export const dynamic = "force-dynamic";
type Params = { q?: string; owner?: string; industry?: string; evidence?: string; status?: string; page?: string };
const STATUS: Record<string, string> = { new: "Awaiting research", researching: "Researching", listed: "Added to outreach", reserve: "Researched reserve", skipped: "Held after research", existing: "Already in Nightwatch", excluded: "Outside current ICP rules" };

function sourceLink(url: string, label: string) {
  return /^https?:\/\//i.test(url) ? <a href={url} target="_blank" rel="noreferrer">{label}</a> : null;
}

export default async function ImportedProspectsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const params = await searchParams;
  const db = admin();
  const live = new Map<string, { status: string; owner: string | null; skip_reason: string | null }>();
  let unavailable = false;
  for (let start = 0; start < importedProspects.length; start += 100) {
    const result = await db.from("list_candidates").select("domain,status,owner,skip_reason").in("domain", importedProspects.slice(start, start + 100).map(row => row.domain));
    if (result.error) { unavailable = true; break; }
    for (const row of result.data ?? []) live.set(row.domain, row);
  }
  const matching = filterImportedProspects(importedProspects, params);
  const pageCount = Math.max(1, Math.ceil(matching.length / 25));
  const page = Math.max(1, Math.min(pageCount, Number.parseInt(params.page ?? "1", 10) || 1));
  const visible = matching.slice((page - 1) * 25, page * 25);
  const href = (next: number) => {
    const query = new URLSearchParams();
    for (const key of ["q", "owner", "industry", "evidence", "status"] as const) if (params[key]) query.set(key, params[key]);
    query.set("page", String(next));
    return `${PROSPECT_IMPORT.href}?${query}`;
  };
  return <div className="shell"><main className="targets-page">
    <PageHead title={PROSPECT_IMPORT.title} actions={<Link className="btn-secondary" href="/outreach">Open outreach drafts</Link>}>Imported October 20. Original company, buyer, email evidence and source notes stay together as research progresses.</PageHead>
    <section className="card" style={{ marginBottom: 20 }}>
      <p><b>500 companies</b> · 478 new research candidates · 239 assigned to Josh and 239 to Suuchi · 7 already known · 15 outside current ICP rules.</p>
      <p>183 emails labeled published and 317 inferred in the workbook. All need review; publication does not establish mailbox delivery. Revenue and workflow claims are research inputs.</p>
      {unavailable && <p role="alert">Live research status is unavailable. Showing the original import classification.</p>}
      <form className="reddit-actions" method="get">
        <input name="q" defaultValue={params.q} placeholder="Search company, person or email" aria-label="Search imported companies" />
        <select name="owner" defaultValue={params.owner ?? ""} aria-label="Assigned owner"><option value="">Both owners</option><option value="josh">Josh</option><option value="suuchi">Suuchi</option></select>
        <select name="industry" defaultValue={params.industry ?? ""} aria-label="Industry"><option value="">All industries</option>{[...new Set(importedProspects.map(row => row.industry))].sort().map(industry => <option key={industry}>{industry}</option>)}</select>
        <select name="evidence" defaultValue={params.evidence ?? ""} aria-label="Email evidence"><option value="">All email evidence</option><option value="Published">Published, unverified</option><option value="Inferred">Inferred, unverified</option></select>
        <select name="status" defaultValue={params.status ?? ""} aria-label="Import classification"><option value="">All import entries</option><option value="new">New candidates</option><option value="existing">Already known</option><option value="excluded">Outside ICP rules</option></select>
        <button className="btn-secondary" type="submit">Filter</button><Link href={PROSPECT_IMPORT.href}>Clear</Link>
      </form>
    </section>
    <p>{matching.length} matching companies · Page {page} of {pageCount}</p>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Company and sources</th><th>Industry</th><th>Revenue claim</th><th>Workbook contact</th><th>Email evidence</th><th>Research status</th></tr></thead><tbody>
      {visible.map(row => {
        const candidate = live.get(row.domain);
        const status = row.importStatus === "new" ? candidate?.status ?? "new" : row.importStatus;
        return <tr key={row.id}>
          <td><strong>{row.company}</strong><br /><small>{row.domain} · {row.hq}</small><details><summary>Workflow, notes and sources</summary><p>{row.workflow}</p><p>{row.opening}</p><p>{row.notes}</p><p>{sourceLink(row.revenueSource, "Revenue source")} · {sourceLink(row.executiveSource, "Executive source")} · {sourceLink(row.emailSource, "Email source")}</p><p>{row.patternBasis}</p><p>Next research: {row.nextAction}</p></details></td>
          <td>{row.sector}</td>
          <td>${row.revenue}M<br /><small>{row.revenueYear} · {row.revenueStatus}</small></td>
          <td>{row.executive}<br /><small>{row.title}</small><br />{row.email}</td>
          <td>{row.emailStatus}</td>
          <td>{STATUS[status] ?? status}<br /><small>{(candidate?.owner ?? row.owner) === "josh" ? "Josh" : (candidate?.owner ?? row.owner) === "suuchi" ? "Suuchi" : "Unassigned"}</small>{(candidate?.skip_reason || row.holdReason) && <p>{candidate?.skip_reason || row.holdReason}</p>}</td>
        </tr>;
      })}
      {!visible.length && <tr><td colSpan={6}>No companies match these filters.</td></tr>}
    </tbody></table></div>
    <nav className="reddit-actions" aria-label="Imported list pages" style={{ marginTop: 20 }}>{page > 1 && <Link className="btn-secondary" href={href(page - 1)}>Previous</Link>}{page < pageCount && <Link className="btn-secondary" href={href(page + 1)}>Next</Link>}</nav>
  </main></div>;
}
