import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildGraph, safeSourceUrl, type Company } from "./graph.ts";
import { allFocus } from "../focus-data.ts";
import { loadNightlyLists } from "../nightly-lists.ts";
import { loadMapCompanies, loadPortfolioGraph, readPages } from "./load.ts";
import { loadTargetCompanies } from "./targets.ts";
export async function loadPortfolio(db: SupabaseClient, options: { overview?: boolean; owner?: "josh" | "suuchi" } = {}) {
  await loadNightlyLists(db);
  const portfolio = options.overview ? await (options.owner ? loadTargetCompanies(db, options.owner) : loadMapCompanies(db)).then((companies) => ({ companies, graph: buildGraph({ companies, people: [], drafts: [], touches: [], signals: [], jobs: [], posts: [], discoveries: [] }) })) : await loadPortfolioGraph(db, Date.now(), options.owner ? await loadTargetCompanies(db, options.owner) : undefined);
  const candidateSchema = z.object({ domain: z.string(), sector: z.string(), revenue_usd_m: z.number().nullable(), revenue_year: z.number().nullable(), source_url: z.string().nullable() });
  let candidates: z.infer<typeof candidateSchema>[] = [];
  try { candidates = candidateSchema.array().parse(await readPages((from, to) => db.from("list_candidates").select("id,domain,sector,revenue_usd_m,revenue_year,source_url").order("id").range(from, to))); }
  catch { portfolio.graph.warnings.push("Candidate revenue research could not be fully loaded. Some financial values may be unknown."); }
  const candidateByDomain = new Map(candidates.map((row) => [row.domain.toLowerCase().replace(/^www\./, ""), row]));
  const focus = new Map(allFocus().map((row) => [row.domain.toLowerCase().replace(/^www\./, ""), row]));
  const enriched: Company[] = portfolio.companies.map((company) => {
    const row = focus.get(company.domain.toLowerCase().replace(/^www\./, ""));
    const candidate = candidateByDomain.get(company.domain.toLowerCase().replace(/^www\./, ""));
    if (!row) return candidate ? { ...company, vertical: company.vertical || candidate.sector || null, revenueUsdM: candidate.revenue_usd_m, revenueStatus: "unconfirmed", revenueYear: candidate.revenue_year, revenueSource: candidate.source_url } : company;
    const revenue = row.revenue as { usdMillions?: number; status?: string; year?: number | null; sourceUrl?: string; employees?: number };
    return { ...company, vertical: company.vertical || row.sector, revenueUsdM: revenue.status === "estimated" ? null : revenue.usdMillions ?? null, revenueStatus: revenue.status ?? "unconfirmed", revenueYear: revenue.year ?? null, revenueSource: revenue.sourceUrl ?? null, employee_range: company.employee_range || (revenue.employees ? `~${revenue.employees}` : null) };
  });
  const companies = new Map(enriched.map((company) => [company.id, company]));
  portfolio.graph.nodes = portfolio.graph.nodes.map((node) => {
    const company = node.kind === "company" && node.companyId ? companies.get(node.companyId) : null;
    return company ? { ...node, facts: node.facts.map((fact) => fact.label === "Industry" ? { ...fact, value: company.vertical || "Not recorded" } : fact.label === "Revenue" ? { ...fact, value: company.revenueUsdM == null ? "Not recorded" : `$${company.revenueUsdM}M · ${company.revenueStatus}${company.revenueYear ? ` · ${company.revenueYear}` : ""}` } : fact.label === "Revenue source" ? { ...fact, value: company.revenueSource || "Not recorded" } : fact.label === "Employees" ? { ...fact, value: company.employee_range || "Not recorded" } : fact) } : node;
  });
  for (const company of enriched) {
    const row = focus.get(company.domain.toLowerCase().replace(/^www\./, ""));
    if (!row || options.overview) continue;
    const rootId = `company:${company.id}`;
    const provenance = [
      { key: "selection", label: "Why this company was selected", detail: [row.fit, row.hypothesis, ...(row.limitations ?? [])].filter(Boolean).join("\n\n"), source: row.trigger?.sourceUrl, at: row.researchDate, facts: [{ label: "List", value: company.outreachList || "Not recorded" }, { label: "Research date", value: row.researchDate || "Not recorded" }, { label: "Added to list", value: "Exact timestamp not recorded" }] },
      { key: "revenue", label: "Revenue & industry", detail: `${company.vertical || "Industry not recorded"}\n${row.revenue.note ?? ""}`, source: company.revenueSource, at: null, facts: [{ label: "Revenue", value: company.revenueUsdM == null ? "Not recorded" : `$${company.revenueUsdM}M` }, { label: "Status", value: company.revenueStatus || "unconfirmed" }, { label: "Year", value: company.revenueYear?.toString() || "Not recorded" }] },
    ];
    for (const context of provenance) {
      const id = `context:${company.id}:${context.key}`, sourceUrl = safeSourceUrl(context.source);
      portfolio.graph.nodes.push({ id, kind: "signal", label: context.label, subtitle: company.name, detail: context.detail, status: "stored list research", companyId: company.id, href: `/accounts/${encodeURIComponent(company.domain)}`, sourceUrl, at: context.at || null, facts: context.facts });
      portfolio.graph.edges.push({ id: `${rootId}:${id}`, from: rootId, to: id, label: context.key === "selection" ? "selected using this research" : "has financial research" });
      if (sourceUrl) {
        const sourceId = `${id}:source`;
        portfolio.graph.nodes.push({ id: sourceId, kind: "source", label: new URL(sourceUrl).hostname, subtitle: sourceUrl, detail: "Original source recorded in the outreach list research.", status: "stored source", companyId: company.id, href: null, sourceUrl, at: null, facts: [{ label: "URL", value: sourceUrl }] });
        portfolio.graph.edges.push({ id: `${id}:${sourceId}`, from: id, to: sourceId, label: "cites this source" });
      }
    }
  }
  return { ...portfolio, companies: enriched };
}
