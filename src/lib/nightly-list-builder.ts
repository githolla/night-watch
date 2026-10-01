import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiFitEvidence, aiFitScore, priorScore, sectorWeights, type AiFit } from "./ai-fit.ts";
import { researchBudget, withBudget } from "./anthropic-cost.ts";
import { runSearchAgent } from "./agents.ts";
import { buildEmail } from "./email-pattern.ts";
import { findEmail, verifierConfigured, verifyEmail } from "./email-verify.ts";
import { allFocus } from "./focus-data.ts";
import { checkWorkflow, listVariants, variantProblems, type ListVariant, type Workflow } from "./list-templates.ts";
import { localParts } from "./local-time.ts";
import { SECTORS, sectorsForNight } from "./list-sectors.ts";
import { researchModel } from "./models.ts";
import { loadNightlyLists } from "./nightly-lists.ts";
import { isLikelyPersonName } from "./pipeline.ts";
import { preparePriorityDraft } from "./prepare-priority-draft.ts";
import { domainAcceptsMail, recordRecipientCheck, type RecipientCheck, type RecipientPerson } from "./recipient-verification.ts";
import type { ListOffer, ListRow } from "./research-data/server.ts";
import type { Owner } from "./types.ts";

type Db = SupabaseClient;

/** Tunables. Defaults: 12 a day each, chosen by AI fit from 20 evaluated per person, $10 a night. */
export function nightlyListConfig() {
  const num = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  return {
    size: Math.floor(num("NIGHTLY_LIST_SIZE", 12, 1, 25)),
    research: Math.floor(num("NIGHTLY_LIST_RESEARCH", 20, 1, 40)),
    /** Lowest AI-fit score (0 to 100) that may go on a list. */
    minFit: Math.floor(num("NIGHTLY_LIST_MIN_FIT", 40, 0, 100)),
    /** How long a well-scoring runner-up may fill a later list without being researched again. */
    reserveDays: Math.floor(num("NIGHTLY_LIST_RESERVE_DAYS", 14, 0, 60)),
    budgetUsd: num("NIGHTLY_LIST_BUDGET_USD", 10, 0.5, 50),
    maxCostPerCompanyUsd: num("NIGHTLY_LIST_MAX_COST_PER_COMPANY_USD", 0.5, 0.05, 2),
    searchesPerCompany: Math.floor(num("ANTHROPIC_MAX_SEARCHES_PER_COMPANY", 3, 1, 5)),
    sourcingSearches: Math.floor(num("NIGHTLY_LIST_SOURCING_SEARCHES", 5, 1, 10)),
    concurrency: Math.floor(num("NIGHTLY_LIST_CONCURRENCY", 3, 1, 6)),
  };
}

export const LIST_OWNERS: Owner[] = ["josh", "jenna"];
const ownerKey = (owner: Owner) => (owner === "josh" ? "josh" : "suuchi");
const domainOf = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:?#]/)[0];

const EXCLUDED = /\b(consult|consulting|advisory|software|saas|it services|managed services|staffing|recruit|agency|marketing|bank|insurance|capital|investment|nonprofit|foundation|university|school|hospital|health system)\b/i;

const sourced = z.object({
  companies: z.array(z.object({
    company: z.string().min(2), domain: z.string().min(4), sector: z.string().default(""), sectorNumber: z.number().int().nullable().default(null),
    revenueUsdM: z.number().nullable().default(null), revenueYear: z.number().int().nullable().default(null), sourceUrl: z.string().nullable().default(null),
    locations: z.number().int().nonnegative().nullable().default(null), fieldService: z.boolean().nullable().default(null),
  })).default([]),
});

const researched = z.union([
  z.object({ reject: z.string().min(2) }),
  z.object({
    sector: z.string().default(""),
    revenue: z.object({ usdMillions: z.number(), year: z.number().int(), sourceUrl: z.string().url() }),
    buyer: z.object({ name: z.string().min(3), title: z.string().min(2), sourceUrl: z.string().url() }),
    email: z.object({ address: z.string().nullable().default(null), sourceUrl: z.string().nullable().default(null) }).nullable().default(null),
    trigger: z.object({ fact: z.string().min(10), sourceUrl: z.string().url(), date: z.string().nullable().default(null) }).nullable().default(null),
    workflow: z.object({ task: z.string(), subject: z.string(), inputs: z.string(), metric: z.string() }),
    evidence: aiFitEvidence.default({ hiring: [], scale: null, change: [], techOpenness: [], systems: [], disqualifiers: [] }),
  }),
]);
type Researched = Exclude<z.infer<typeof researched>, { reject: string }>;

type Candidate = { id: string; company: string; domain: string; sector: string; revenue_usd_m: number | null; revenue_year: number | null; source_url: string | null; sector_key: number | null };
/** A finished list row kept for a later night: the row, its versions and its address check. */
type Prepared = { row: ListRow; offer: ListOffer };
type ListRecord = { id: string; list_date: string; owner: Owner; status: string; rows: ListRow[]; offers: ListOffer[]; attempts: number; cost_usd: number; errors: unknown[] };
type Verdict = { email: string; emailStatus: "verified" | "published_unverified" | "inferred"; emailSourceUrl: string; note: string; check: RecipientCheck };

/** Companies already handled anywhere: curated files, earlier nightly candidates, or excluded or contacted accounts. */
async function knownDomains(db: Db): Promise<Set<string>> {
  const known = new Set(allFocus().map((row) => domainOf(row.domain)));
  const [{ data: candidates }, { data: blocked }, { data: touched }] = await Promise.all([
    db.from("list_candidates").select("domain").limit(20000),
    db.from("accounts").select("domain").in("status", ["client", "do_not_contact"]).limit(20000),
    db.from("touches").select("cards(accounts(domain))").limit(20000),
  ]);
  for (const row of candidates ?? []) known.add(domainOf(row.domain as string));
  for (const row of blocked ?? []) known.add(domainOf(row.domain as string));
  for (const row of touched ?? []) {
    const domain = (row.cards as unknown as { accounts: { domain: string } | null } | null)?.accounts?.domain;
    if (domain) known.add(domainOf(domain));
  }
  return known;
}

/** Find new companies in published rankings, two sectors a night in rotation. */
/** Positive replies by sector, from cards sent to listed companies; feeds sectorWeights. */
async function learnedSectorWeights(db: Db): Promise<Record<string, number>> {
  const { data: listed } = await db.from("list_candidates").select("domain,sector_key").eq("status", "listed").not("sector_key", "is", null).limit(5000);
  const sectorByDomain = new Map((listed ?? []).map((row) => [row.domain as string, String(row.sector_key)]));
  if (!sectorByDomain.size) return {};
  const outcomes: Array<{ sector: string; positive: boolean }> = [];
  const domains = [...sectorByDomain.keys()];
  for (let index = 0; index < domains.length; index += 200) {
    const { data } = await db.from("cards").select("status,accounts!inner(domain)").in("accounts.domain", domains.slice(index, index + 200)).in("status", ["sent", "replied", "positive", "meeting"]);
    for (const card of data ?? []) {
      const domain = (card.accounts as unknown as { domain: string }).domain;
      outcomes.push({ sector: sectorByDomain.get(domain) ?? "", positive: ["positive", "meeting"].includes(card.status as string) });
    }
  }
  return sectorWeights(outcomes);
}

async function sourceCandidates(db: Db, listDate: string, recordCost: (cost: number) => void): Promise<number> {
  const config = nightlyListConfig();
  const day = Math.floor(Date.parse(`${listDate}T00:00:00Z`) / 86_400_000);
  const weights = await learnedSectorWeights(db).catch(() => ({} as Record<string, number>));
  const chosen = sectorsForNight(day, weights);
  const known = await knownDomains(db);
  const { data: recent } = await db.from("list_candidates").select("company").order("created_at", { ascending: false }).limit(60);
  const skip = (recent ?? []).map((row) => row.company as string).join("; ");
  const prompt = `Find privately held U.S. operating companies with annual revenue between $10M and $100M that appear in a published, dated industry ranking or list, for example Landscape Management's LM150, ENR regional rankings, a Crain's or Business Journal list of largest private companies, a trade association top-100 list, or an Inc. regional list that states revenue.

Focus on these sectors, numbered: ${chosen.map((index) => `${index}. ${SECTORS[index]}`).join("; ")}.
Prefer companies with several locations or branches, field crews or a fleet, or high order and quoting volume: the coordination and paperwork an AI tool can take on.
Exclude consulting, IT services, software, staffing, marketing agencies, banks, insurance, investment firms, nonprofits, schools, hospitals and public companies.${skip ? `\nAlready found, do not repeat: ${skip}.` : ""}

For each company give its official website domain, its sector and the sector's number from the list above, the reported revenue in USD millions, the year it was reported for, the URL of the ranking page that states it, and, only if the ranking or the company's site shows it, how many locations it has and whether it runs field crews or a fleet. Never invent a company, a revenue figure, a domain or a URL; list only what the page shows. Aim for 25 companies.

Return JSON only: {"companies":[{"company":"","domain":"example.com","sector":"","sectorNumber":0,"revenueUsdM":0,"revenueYear":2025,"sourceUrl":"https://...","locations":null,"fieldService":null}]}`;
  const budget = researchBudget(config.sourcingSearches, config.maxCostPerCompanyUsd * 2);
  const parsed = sourced.parse(await runSearchAgent(prompt, { model: researchModel(), maxSearches: config.sourcingSearches, maxTokens: 8_000 }, withBudget(recordCost, budget)));
  const rows = parsed.companies
    .map((company) => ({ ...company, domain: domainOf(company.domain) }))
    .filter((company) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(company.domain) && !known.has(company.domain))
    .filter((company) => !EXCLUDED.test(`${company.company} ${company.sector}`))
    .filter((company) => company.revenueUsdM === null || (company.revenueUsdM >= 10 && company.revenueUsdM <= 100))
    .map((company) => {
      const sectorKey = company.sectorNumber !== null && chosen.includes(company.sectorNumber) ? company.sectorNumber : chosen[0];
      const prior = priorScore({ revenueUsdM: company.revenueUsdM, locations: company.locations, fieldService: company.fieldService, sectorRank: sectorKey, sectorWeight: weights[String(sectorKey)] ?? 1 });
      return { company: company.company.trim(), domain: company.domain, sector: company.sector.trim(), revenue_usd_m: company.revenueUsdM, revenue_year: company.revenueYear, source_url: company.sourceUrl, sector_key: sectorKey, prior_score: prior };
    });
  if (!rows.length) return 0;
  const { data, error } = await db.from("list_candidates").upsert(rows, { onConflict: "domain", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`Could not save new companies: ${error.message}`);
  return data?.length ?? 0;
}

function researchPrompt(candidate: Candidate) {
  return `Research ${candidate.company} (${candidate.domain}), a ${candidate.sector || "U.S. operating"} company. Nine-67 builds AI tools with operations teams, and we are preparing one short cold email to a senior leader there. Use public sources and never invent a fact, a person, an address, a date or a URL.

1. Revenue: the most recent reported annual revenue in USD millions and the year, with the URL that states it.${candidate.source_url ? ` Start from ${candidate.source_url}${candidate.revenue_usd_m ? ` (listed at $${candidate.revenue_usd_m}M${candidate.revenue_year ? ` for ${candidate.revenue_year}` : ""})` : ""}.` : ""}
2. Buyer: the current CEO, President, COO or owner, with the URL of a page showing their name and title.
3. Email: only if a public page shows that person's business email at this company, give it with that URL. Otherwise null. Never guess an address.
4. Trigger (optional): a dated public development in the last 180 days, such as a new location, an acquisition, a leadership change or an award, with its URL and date. Otherwise null.
5. AI-fit evidence. Only facts a page shows, each with its https URL, and a date where the page gives one:
   - hiring: open roles doing coordination, scheduling, dispatch, estimating, quoting, admin, billing, data, reporting or automation work, from the careers page or a job board;
   - scale: the number of locations or branches, field staff or vehicles, or a stated volume such as jobs, orders or customers a year, with the page that shows it;
   - change: acquisitions, new locations, a new CEO, COO or operations leader, or new investment in the last 12 months;
   - techOpenness: leaders speaking publicly about AI, automation, technology or efficiency, or technology roles in the leadership team;
   - systems: business software they name, such as field service, ERP, CRM, estimating or routing tools, or a customer portal;
   - disqualifiers: reasons this is not a fit, such as being a software or IT business, already having a large in-house engineering or AI team, or closing down.
   Leave a part empty rather than guess.
6. Workflow: one practical piece of work a company like this probably handles by hand that an AI tool could help with, drawn from the evidence above where you can (the roles being hired, the volume, the locations). It is an idea, not a claim about them. Give: task, a short lowercase noun phrase such as "branch service follow-up"; subject, two to five lowercase words for an email subject; inputs, what the tool would bring together, three items in one phrase such as "site inspection notes, the promised fix and evidence that it was completed"; metric, what to measure, such as "time spent chasing updates". No question marks, dashes or links in these.

Return {"reject":"reason"} instead if revenue is outside $10M to $100M, the company is consulting, IT, software, staffing, an agency, a financial firm, a nonprofit or public, it has closed or been acquired, or no current senior leader can be named from a source.

Return JSON only: {"sector":"","revenue":{"usdMillions":0,"year":2025,"sourceUrl":"https://..."},"buyer":{"name":"","title":"","sourceUrl":"https://..."},"email":{"address":null,"sourceUrl":null},"trigger":null,"evidence":{"hiring":[{"title":"","url":"https://...","postedDate":null}],"scale":{"locations":null,"fieldWorkforce":null,"highVolume":null,"url":null},"change":[{"kind":"","fact":"","date":null,"url":"https://..."}],"techOpenness":[{"fact":"","date":null,"url":"https://..."}],"systems":[{"name":"","url":"https://..."}],"disqualifiers":[]},"workflow":{"task":"","subject":"","inputs":"","metric":""}}`;
}

/** Choose the address and check it: published first, then Hunter's finder, then first.last. Null skips the company. */
async function chooseEmail(found: Researched, domain: string): Promise<Verdict | { problem: string }> {
  const at = `@${domain}`;
  const options: Array<{ email: string; status: Verdict["emailStatus"]; source: string; note: string }> = [];
  const published = found.email?.address?.trim().toLowerCase();
  if (published && published.endsWith(at) && found.email?.sourceUrl) options.push({ email: published, status: "published_unverified", source: found.email.sourceUrl, note: "Published on the linked page." });
  if (verifierConfigured()) {
    try {
      const hunter = await findEmail(found.buyer.name, domain);
      if (hunter && hunter.email.endsWith(at) && hunter.result.status !== "invalid") options.push({ email: hunter.email, status: hunter.result.status === "verified" ? "verified" : "inferred", source: found.buyer.sourceUrl, note: "Found by Hunter's email finder." });
    } catch { /* Hunter unavailable: fall through to the company format. */ }
  }
  const built = buildEmail(found.buyer.name, "first.last", domain);
  if (built) options.push({ email: built, status: "inferred", source: found.buyer.sourceUrl, note: "Built from the most common first.last format. Not confirmed." });

  const mailHost = await domainAcceptsMail(domain);
  if (mailHost === false) return { problem: `${domain} does not accept email` };
  const now = new Date().toISOString();
  for (const option of options) {
    let hunterStatus: string | null = null;
    if (verifierConfigured()) {
      try { hunterStatus = (await verifyEmail(option.email)).status; } catch (error) { hunterStatus = `error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 100); }
      if (hunterStatus === "invalid") continue;
    }
    const verified = hunterStatus === "verified";
    const check: RecipientCheck = {
      email: option.email, level: verified ? "deliverable" : "risky", source: hunterStatus && !hunterStatus.startsWith("error") ? "hunter" : "own",
      status: verified ? "verified" : hunterStatus === "catch_all" ? "catch_all" : "unverified",
      reason: verified ? "Hunter verified this address." : hunterStatus === "catch_all" ? "The domain accepts every address, so it cannot be confirmed." : "Not confirmed by Hunter.",
      suggestion: null, hunter: hunterStatus, mailHost, checkedAt: now,
    };
    return { email: option.email, emailStatus: verified ? "verified" : option.status, emailSourceUrl: option.source, note: verified ? `${option.note} Verified by Hunter.` : option.note, check };
  }
  return { problem: "no deliverable address for the buyer" };
}

function listRow(candidate: Candidate, found: Researched, workflow: Workflow, verdict: Verdict, owner: Owner, listDate: string, rank: number, variants: ListVariant[], fit: AiFit): { row: ListRow; offer: ListOffer } {
  const direct = variants[0];
  const change = found.evidence.change[0];
  const trigger = found.trigger
    ? { fact: found.trigger.fact, sourceUrl: found.trigger.sourceUrl, date: found.trigger.date }
    : change ? { fact: change.fact, sourceUrl: change.url, date: change.date }
    : { fact: `${candidate.company}: ${found.buyer.name}, ${found.buyer.title}. Proposed area to explore: ${workflow.task}.`, sourceUrl: found.buyer.sourceUrl, date: null };
  const contact = {
    name: found.buyer.name, title: found.buyer.title, sourceUrl: found.buyer.sourceUrl, email: verdict.email, emailStatus: verdict.emailStatus,
    emailSourceUrl: verdict.emailSourceUrl, emailNote: verdict.note, emailPublishedDate: null, subject: direct.subject, message: direct.message,
    contact_rank: 1, contact_id: `nightly-${listDate}-${candidate.domain}`,
  };
  const row = {
    company: candidate.company, domain: candidate.domain, sector: found.sector || candidate.sector,
    revenue: { usdMillions: found.revenue.usdMillions, year: found.revenue.year, status: "reported", sourceUrl: found.revenue.sourceUrl, note: `${found.revenue.year} revenue reported by the cited source; not independently audited. Revenue fit does not establish budget or buying intent.` },
    trigger, reframe: workflow.task, contacts: [contact], rank, researchDate: listDate, targetRole: "executive", proofKind: "owner-supplied-delivery",
    hypothesis: `Proposed workflow: ${workflow.task}. This is an outreach idea, not a confirmed internal problem.`,
    fit: fit.summary,
    // Extra fields beyond the curated shape: the scored evidence behind the list, and the address check.
    aiFit: fit,
    emailCheck: verdict.check,
    limitations: ["Workflow need and budget have not been confirmed.", `Revenue is reported for ${found.revenue.year}, not verified current revenue.`, "Researched automatically overnight; recheck the role if this company is contacted much later."],
    buyer: { name: found.buyer.name, title: found.buyer.title, sourceUrl: found.buyer.sourceUrl, email: verdict.email },
    subject: direct.subject, message: direct.message,
    writerKit: { accountId: `nightly-${candidate.domain}`, frame: "direct-offer", sendWave: 1, factIds: [], facts: [], review: "Generated overnight from the approved batch-3 templates.", reframe: workflow.task, avoid: [], subjectIdeas: [direct.subject], touch1Cta: direct.message.split("\n").at(-1) ?? "" },
    assignedOwner: ownerKey(owner),
  };
  // The JSON-inferred batch type is the contract; the object above carries every field it declares.
  return { row: row as unknown as ListRow, offer: { domain: candidate.domain, contactName: found.buyer.name, variants } as unknown as ListOffer };
}

async function researchOne(candidate: Candidate, owner: Owner, listDate: string, rank: number): Promise<{ row?: ListRow; offer?: ListOffer; skip?: string; cost: number; verdict?: Verdict; fit?: AiFit }> {
  const config = nightlyListConfig();
  let cost = 0;
  const budget = researchBudget(config.searchesPerCompany, config.maxCostPerCompanyUsd);
  try {
    const raw = await runSearchAgent(researchPrompt(candidate), { model: researchModel(), maxSearches: config.searchesPerCompany, maxTokens: 6_000 }, withBudget((value) => { cost += value; }, budget));
    const parsed = researched.parse(raw);
    if ("reject" in parsed) return { skip: `rejected: ${parsed.reject}`, cost };
    if (parsed.revenue.usdMillions < 10 || parsed.revenue.usdMillions > 100) return { skip: `revenue $${parsed.revenue.usdMillions}M is outside $10M to $100M`, cost };
    if (!isLikelyPersonName(parsed.buyer.name)) return { skip: `"${parsed.buyer.name}" is not a person's name`, cost };
    if (EXCLUDED.test(`${parsed.sector} ${candidate.company}`)) return { skip: "excluded sector", cost };
    const fit = aiFitScore(parsed.evidence);
    if (fit.disqualified) return { skip: `not an AI fit: ${fit.disqualified}`, cost, fit };
    if (fit.score < config.minFit) return { skip: `AI fit ${fit.score} is below ${config.minFit}`, cost, fit };
    const checked = checkWorkflow(parsed.workflow);
    if ("problem" in checked) return { skip: checked.problem, cost };
    const variants = listVariants(candidate.company, checked.workflow);
    const problems = variantProblems(variants);
    if (problems.length) return { skip: `copy failed checks: ${problems.slice(0, 2).join("; ")}`, cost };
    const verdict = await chooseEmail(parsed, candidate.domain);
    if ("problem" in verdict) return { skip: verdict.problem, cost };
    return { ...listRow(candidate, parsed, checked.workflow, verdict, owner, listDate, rank, variants, fit), cost, verdict, fit };
  } catch (error) {
    return { skip: `research failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300), cost };
  }
}

async function loadLists(db: Db, listDate: string): Promise<ListRecord[]> {
  const { data, error } = await db.from("reachout_lists").select("id,list_date,owner,status,rows,offers,attempts,cost_usd,errors").eq("list_date", listDate);
  if (error) throw new Error(`Could not read tonight's lists: ${error.message}`);
  return (data ?? []).map((row) => ({ ...row, rows: (row.rows ?? []) as ListRow[], offers: (row.offers ?? []) as ListOffer[], cost_usd: Number(row.cost_usd ?? 0), errors: (row.errors ?? []) as unknown[] })) as ListRecord[];
}

/** Seed the cards for a finished list (same path as opening the desk) and save each address check on the person. */
const fitOf = (row: ListRow) => (row as ListRow & { aiFit?: AiFit }).aiFit?.score ?? 0;
const checkOf = (row: ListRow) => (row as ListRow & { emailCheck?: RecipientCheck }).emailCheck ?? null;

/**
 * Close a list: keep its `size` best companies by AI fit, return the runners-up to the pool as reserves a
 * later night can use without researching them again, then prepare a card for each company kept (the same
 * path as opening the desk) and save each address check on the person.
 */
async function finalizeList(db: Db, list: ListRecord) {
  const config = nightlyListConfig();
  const ranked = [...list.rows].sort((a, b) => fitOf(b) - fitOf(a));
  const kept = ranked.slice(0, config.size).map((row, index) => ({ ...row, rank: index + 1 }) as ListRow);
  const keptDomains = new Set(kept.map((row) => row.domain));
  for (const row of ranked.slice(config.size)) {
    const offer = list.offers.find((item) => item.domain === row.domain);
    await db.from("list_candidates").update({ status: "reserve", owner: null, list_date: null, prepared: { row, offer } satisfies Partial<Prepared>, updated_at: new Date().toISOString() }).eq("domain", row.domain);
  }
  const status = kept.length ? "ready" : "failed";
  await db.from("reachout_lists").update({ status, rows: kept, offers: list.offers.filter((offer) => keptDomains.has(offer.domain)), updated_at: new Date().toISOString() }).eq("id", list.id).eq("status", "building");
  if (status !== "ready") return;
  await loadNightlyLists(db, { force: true });
  const owner = list.owner;
  const builder = { id: "nightly-list", email: "", name: "Night Watch", owner, role: "admin" as const };
  for (const row of kept) {
    try {
      await preparePriorityDraft(row.domain, builder, db);
      const check = checkOf(row);
      if (!check) continue;
      const { data: account } = await db.from("accounts").select("id").eq("domain", row.domain).maybeSingle();
      if (!account) continue;
      const { data: person } = await db.from("people").select("id,full_name,email,email_status,email_source,email_verified_at,email_check").eq("account_id", account.id).ilike("full_name", row.buyer.name).maybeSingle();
      if (person && person.email?.toLowerCase() === check.email) await recordRecipientCheck(db, person as RecipientPerson, check);
    } catch (error) {
      console.error(`[night-watch] could not prepare ${row.domain} for ${owner}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Take a reserve onto this list: an earlier night's finished row, moved to this seat and date. Free. */
async function claimReserve(db: Db, list: ListRecord, listDate: string, minFit: number, reserveDays: number): Promise<boolean> {
  const since = new Date(Date.now() - reserveDays * 86_400_000).toISOString();
  const { data: reserves } = await db.from("list_candidates").select("id,domain,prepared,fit_score").eq("status", "reserve").gte("researched_at", since).gte("fit_score", minFit).order("fit_score", { ascending: false }).limit(3);
  for (const reserve of reserves ?? []) {
    const prepared = reserve.prepared as Prepared | null;
    if (!prepared?.row || !prepared.offer) continue;
    const { data: claimed } = await db.from("list_candidates").update({ status: "listed", owner: list.owner, list_date: listDate, updated_at: new Date().toISOString() }).eq("id", reserve.id).eq("status", "reserve").select("id");
    if (!claimed?.length) continue;
    const row = { ...prepared.row, assignedOwner: ownerKey(list.owner), contacts: prepared.row.contacts.map((contact) => ({ ...contact, contact_id: `nightly-${listDate}-${reserve.domain}` })) } as ListRow;
    const fresh = (await loadLists(db, listDate)).find((item) => item.id === list.id)!;
    await db.from("reachout_lists").update({ rows: [...fresh.rows, row], offers: [...fresh.offers, prepared.offer], attempts: fresh.attempts + 1, updated_at: new Date().toISOString() }).eq("id", list.id);
    return true;
  }
  return false;
}

export type NightlyListResult = { listDate: string; lists: Array<{ owner: Owner; status: string; rows: number; attempts: number; costUsd: number }>; sourced: number; reservesUsed: number; stopped: "done" | "time_budget" | "cost_budget" | "no_candidates" };

/**
 * Build tonight's lists. Resumable: each cron invocation does what fits in its time budget and saves
 * progress in reachout_lists and list_candidates; the next invocation carries on.
 *
 * Each list evaluates `research` companies: reserves from earlier nights first (free), then new companies in
 * order of their pre-research score. Companies under the AI-fit minimum are skipped. When a list has
 * evaluated enough, or the night's budget or the pool runs out, it keeps its `size` best by AI fit.
 */
export async function runNightlyListBuild(db: Db, options: { now?: Date; timeBudgetMs?: number } = {}): Promise<NightlyListResult> {
  const config = nightlyListConfig();
  const started = Date.now();
  const timeBudget = options.timeBudgetMs ?? 240_000;
  const listDate = localParts(options.now ?? new Date()).date;
  // AI-fit selection stores scores and reserves in columns added by 0028; without them it would half-work.
  const { error: schemaError } = await db.from("list_candidates").select("prior_score,fit_score,prepared").limit(1);
  if (schemaError) throw new Error("Apply supabase/migrations/0027_nightly_lists.sql and 0028_ai_fit.sql in the Supabase SQL editor before the nightly list can run.");
  await db.from("reachout_lists").upsert(LIST_OWNERS.map((owner) => ({ list_date: listDate, owner })), { onConflict: "list_date,owner", ignoreDuplicates: true });
  // A claim left by an invocation that timed out mid-research goes back in the queue.
  await db.from("list_candidates").update({ status: "new", owner: null, list_date: null }).eq("status", "researching").lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString());
  await loadNightlyLists(db);
  let sourcedCount = 0, reservesUsed = 0, sourcedThisRun = false, reservesExhausted = false;
  let stopped: NightlyListResult["stopped"] = "done";

  for (;;) {
    const lists = await loadLists(db, listDate);
    const spent = lists.reduce((sum, list) => sum + list.cost_usd, 0);
    const building = lists.filter((list) => list.status === "building");
    if (!building.length) break;
    if (spent >= config.budgetUsd) { stopped = "cost_budget"; for (const list of building) await finalizeList(db, list); break; }
    for (const list of building) if (list.attempts >= config.research) await finalizeList(db, list);
    const open = building.filter((list) => list.attempts < config.research);
    if (!open.length) continue;
    if (Date.now() - started > timeBudget) { stopped = "time_budget"; break; }

    if (!reservesExhausted) {
      let claimedAny = false;
      for (const list of open) if (await claimReserve(db, list, listDate, config.minFit, config.reserveDays)) { claimedAny = true; reservesUsed += 1; }
      if (claimedAny) continue;
      reservesExhausted = true;
    }

    const slots = Math.min(config.concurrency, open.reduce((sum, list) => sum + (config.research - list.attempts), 0));
    const { data: queue } = await db.from("list_candidates").select("id,company,domain,sector,revenue_usd_m,revenue_year,source_url,sector_key").eq("status", "new").order("prior_score", { ascending: false }).order("revenue_usd_m", { ascending: false, nullsFirst: false }).limit(slots * 2);
    if ((queue ?? []).length < slots && !sourcedThisRun) {
      sourcedThisRun = true;
      const firstList = lists[0];
      const added = await sourceCandidates(db, listDate, (cost) => { firstList.cost_usd += cost; }).catch((error) => { console.error(`[night-watch] sourcing failed: ${error instanceof Error ? error.message : String(error)}`); return 0; });
      sourcedCount += added;
      await db.from("reachout_lists").update({ cost_usd: Number(firstList.cost_usd.toFixed(6)) }).eq("id", firstList.id);
      continue;
    }
    if (!(queue ?? []).length) { stopped = "no_candidates"; for (const list of open) await finalizeList(db, list); break; }

    // Never give a list more research in flight than it has evaluations left, alternating seats.
    const room = new Map(open.map((list) => [list.id, config.research - list.attempts]));
    const tasks: Array<{ list: ListRecord; candidate: Candidate }> = [];
    let turn = 0;
    for (const candidate of (queue ?? []) as Candidate[]) {
      const withRoom = open.filter((list) => (room.get(list.id) ?? 0) > 0);
      if (tasks.length >= slots || !withRoom.length) break;
      const list = withRoom[turn++ % withRoom.length];
      const { data: claimed } = await db.from("list_candidates").update({ status: "researching", owner: list.owner, list_date: listDate, updated_at: new Date().toISOString() }).eq("id", candidate.id).eq("status", "new").select("id");
      if (claimed?.length) { tasks.push({ list, candidate }); room.set(list.id, (room.get(list.id) ?? 0) - 1); }
    }
    const results = await Promise.all(tasks.map(({ list, candidate }) => researchOne(candidate, list.owner, listDate, 0)));
    for (let index = 0; index < tasks.length; index++) {
      const { list, candidate } = tasks[index], result = results[index];
      const fresh = (await loadLists(db, listDate)).find((item) => item.id === list.id)!;
      const rows = result.row ? [...fresh.rows, result.row] : fresh.rows;
      const offers = result.offer ? [...fresh.offers, result.offer] : fresh.offers;
      const errors = result.skip ? [...fresh.errors, { domain: candidate.domain, reason: result.skip }].slice(-50) : fresh.errors;
      await db.from("reachout_lists").update({ rows, offers, errors, attempts: fresh.attempts + 1, cost_usd: Number((fresh.cost_usd + result.cost).toFixed(6)), updated_at: new Date().toISOString() }).eq("id", list.id);
      await db.from("list_candidates").update({
        status: result.row ? "listed" : "skipped", skip_reason: result.skip ?? null, cost_usd: Number(result.cost.toFixed(6)),
        fit_score: result.fit?.score ?? null, fit: result.fit ?? null, researched_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", candidate.id);
    }
  }

  const lists = await loadLists(db, listDate);
  return {
    listDate, sourced: sourcedCount, reservesUsed, stopped,
    lists: lists.map((list) => ({ owner: list.owner, status: list.status, rows: list.rows.length, attempts: list.attempts, costUsd: Number(list.cost_usd.toFixed(4)) })),
  };
}
