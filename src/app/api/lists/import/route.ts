import { z } from "zod";
import { listImportAuthorized } from "@/lib/auth";
import { REVENUE_BAND_USD_M, SECTORS } from "@/lib/list-sectors";
import { addressesToWork, importAddressEvidence, importResearchedList, nightlyListConfig, screenDomains, type EmailEvidence, type ResearchedCompany } from "@/lib/nightly-list-builder";
import { researchPrompt } from "@/lib/nightly-research";
import { admin } from "@/lib/supabase/admin";
import { seatOwner } from "@/lib/types";

export const maxDuration = 300;

const listDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const emailEvidence = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("published"), address: z.string().email(), sourceUrl: z.string().url() }),
  z.object({ kind: z.literal("format"), address: z.string().email(), examples: z.array(z.object({ name: z.string(), email: z.string().email(), sourceUrl: z.string().url() })).max(6) }),
]) satisfies z.ZodType<EmailEvidence>;
const company = z.object({
  company: z.string().min(2), domain: z.string().min(4), sector: z.string().optional(), revenueUsdM: z.number().nullable().optional(),
  revenueYear: z.number().int().nullable().optional(), sourceUrl: z.string().url().nullable().optional(), research: z.unknown(), emailEvidence: emailEvidence.optional(),
}) satisfies z.ZodType<ResearchedCompany>;
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("brief"), listDate }),
  z.object({ action: z.literal("status"), listDate }),
  z.object({ action: z.literal("check"), domains: z.array(z.string()).min(1).max(200) }),
  z.object({ action: z.literal("import"), listDate, owner: z.string(), companies: z.array(company).min(1).max(40) }),
  z.object({ action: z.literal("addresses") }),
  z.object({ action: z.literal("addresses-import"), items: z.array(z.object({ personId: z.string(), domain: z.string(), name: z.string(), emailEvidence })).min(1).max(200) }),
]);

/**
 * The nightly list routine (Claude Code, run outside the app) researches companies and addresses, then
 * calls this to load them through the same checks as the command-line importer. Its secret can only add
 * lists and address evidence; every cited page is fetched again here before anything is trusted.
 */
export async function POST(request: Request) {
  if (!listImportAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = input.parse(await request.json());
    const db = admin();
    if (body.action === "brief") {
      const template = researchPrompt({ id: "", company: "<company>", domain: "<domain>", sector: "<sector>", revenue_usd_m: null, revenue_year: null, source_url: null, sector_key: null }, body.listDate);
      const config = nightlyListConfig();
      return Response.json({ revenueBandUsdM: REVENUE_BAND_USD_M, sectors: SECTORS, listSize: config.size, minFit: config.minFit, researchPrompt: template });
    }
    if (body.action === "status") {
      const { data, error } = await db.from("reachout_lists").select("owner,status,rows").eq("list_date", body.listDate);
      if (error) throw new Error(error.message);
      const lists = (data ?? []).map((list) => ({ owner: list.owner as string, status: list.status as string, rows: Array.isArray(list.rows) ? list.rows.length : 0 }));
      return Response.json({ listDate: body.listDate, lists, unconfirmedAddresses: (await addressesToWork(db)).length });
    }
    if (body.action === "check") return Response.json({ domains: await screenDomains(db, body.domains) });
    if (body.action === "import") {
      const owner = seatOwner(body.owner);
      if (!owner) throw new Error(`Unknown seat ${body.owner}; use josh or suuchi.`);
      return Response.json(await importResearchedList(db, { listDate: body.listDate, owner, companies: body.companies }));
    }
    if (body.action === "addresses") return Response.json({ people: await addressesToWork(db) });
    return Response.json({ addresses: await importAddressEvidence(db, body.items) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "List import failed" }, { status: 400 });
  }
}
