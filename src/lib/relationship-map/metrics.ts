import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPages, loadMapCompanies } from "./load.ts";
import { loadTargetCompanies } from "./targets.ts";
import { type CompanyMetrics, type PortfolioMetrics } from "./view.ts";
export { metricKeys, metricsSchema, type PortfolioMetrics } from "./view.ts";
export async function loadPortfolioMetrics(db: SupabaseClient, owner?: "josh" | "suuchi"): Promise<PortfolioMetrics> {
  const companies = owner ? await loadTargetCompanies(db, owner) : await loadMapCompanies(db);
  const accountIds = companies.map((company) => company.id);
  if (!accountIds.length) return { companies: {}, warnings: [] };
  const result: PortfolioMetrics = { companies: Object.fromEntries(companies.map((company) => [company.id, { person: 0, draft: 0, outreach: 0, reply: 0, bounce: 0, signal: 0, job: 0, post: 0, discovery: 0 }])), warnings: [] };
  const member = z.object({ id: z.string(), account_id: z.string() });
  async function members(table: string, kind: keyof CompanyMetrics) {
    try { const rows: z.infer<typeof member>[] = []; for (let offset = 0; offset < accountIds.length; offset += 100) rows.push(...member.array().parse(await readPages((from, to) => db.from(table).select("id,account_id").in("account_id", accountIds.slice(offset, offset + 100)).order("id").range(from, to)))); for (const row of rows) if (result.companies[row.account_id]) result.companies[row.account_id][kind]++; return rows; }
    catch { result.warnings.push(`${table} totals are unavailable.`); return []; }
  }
  const cards = members("cards", "draft");
  await Promise.all([
    members("people", "person"), members("signals", "signal"), members("job_postings", "job"), members("public_posts", "post"),
    (async () => {
      const cardCompanies = new Map((await cards).map((card) => [card.id, card.account_id]));
      try {
        const schema = z.object({ card_id: z.string(), sent_at: z.string().nullable(), reply_at: z.string().nullable(), bounced_at: z.string().nullable() });
        const rows: z.infer<typeof schema>[] = []; const cardIds = [...cardCompanies.keys()]; for (let offset = 0; offset < cardIds.length; offset += 100) rows.push(...schema.array().parse(await readPages((from, to) => db.from("touches").select("id,card_id,sent_at,reply_at,bounced_at").in("card_id", cardIds.slice(offset, offset + 100)).order("id").range(from, to))));
        for (const row of rows) { const id = cardCompanies.get(row.card_id); if (!id || !row.sent_at || !result.companies[id]) continue; result.companies[id].outreach++; if (row.reply_at) result.companies[id].reply++; if (row.bounced_at) result.companies[id].bounce++; }
      } catch { result.warnings.push("Delivery totals are unavailable."); }
    })(),
    (async () => {
      try { const schema = z.object({ company_domain: z.string().nullable(), company_confirmed: z.boolean() }); const domains = new Map(companies.map((company) => [company.domain.toLowerCase().replace(/^www\./, ""), company.id]));
        const rows = schema.array().parse(await readPages((from, to) => db.from("discovery_opportunities").select("id,company_domain,company_confirmed").eq("company_confirmed", true).in("company_domain", companies.map((company) => company.domain)).order("id").range(from, to)));
        for (const row of rows) { const id = row.company_confirmed && row.company_domain ? domains.get(row.company_domain.toLowerCase().replace(/^www\./, "")) : null; if (id) result.companies[id].discovery++; }
      } catch { result.warnings.push("Discovery totals are unavailable."); }
    })(),
  ]);
  return result;
}
