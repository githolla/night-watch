import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Company } from "./graph.ts";
import { allFocus } from "../focus-data.ts";
import { loadNightlyLists } from "../nightly-lists.ts";
import { loadPortfolioGraph, readPages } from "./load.ts";
export async function loadPortfolio(db: SupabaseClient) {
  await loadNightlyLists(db);
  const portfolio = await loadPortfolioGraph(db);
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
  return { ...portfolio, companies: enriched };
}
