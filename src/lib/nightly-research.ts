import { z } from "zod";
import { aiFitEvidence, aiFitScore, DISQUALIFIER_KINDS, isFreshDate, type AiFit, type AiFitCriterion, type AiFitEvidence, type AiFitReason, type Grounding } from "./ai-fit.ts";
import { researchBudget, withBudget, type UsageRecorder } from "./anthropic-cost.ts";
import { NOT_TARGET_ROLES, runGroundedSearchAgent, runWritingAgent } from "./agents.ts";
import { addressMatchesPerson, buildEmail } from "./email-pattern.ts";
import { findEmail, verifierConfigured, verifyEmail, type FoundEmail, type VerifyResult } from "./email-verify.ts";
import { groundEvidence, normalizeUrl, onDomain, pageAgeDate, type Fetcher, type Lookup, type SeenSource } from "./evidence-grounding.ts";
import { checkWorkflow, chooseArm, listVariants, normalizeWorkflow, repairWorkflow, speakableCompany, variantProblems, type ListVariant, type Workflow } from "./list-templates.ts";
import { researchModel } from "./models.ts";
import { HEADCOUNT_BAND, inHeadcountBand, inRevenueBand, REVENUE_BAND_TEXT } from "./list-sectors.ts";
import { isLikelyPersonName } from "./pipeline.ts";
import { domainAcceptsMail, type RecipientCheck } from "./recipient-verification.ts";
import type { ListOffer, ListRow } from "./research-data/server.ts";
import type { Owner } from "./types.ts";

/**
 * One company's overnight research: a paid search turn, then free checks in code (grounding, buyer, address,
 * revenue, copy) before it can become a list row. Every dependency is injectable so the whole step runs in
 * a plain node test.
 */

export { addressMatchesPerson };

export type Candidate = { id: string; company: string; domain: string; sector: string; revenue_usd_m: number | null; revenue_year: number | null; source_url: string | null; sector_key: number | null };
export type Verdict = {
  email: string; emailStatus: "verified" | "published_unverified" | "inferred"; emailSourceUrl: string; note: string; check: RecipientCheck;
  /** Why this address may not be the buyer's, so the morning run must leave it for a person. */
  identityHold: string | null;
};

/** The same env vars and bounds as nightlyListConfig; read here so this module does not import the builder. */
export function researchLimits() {
  const num = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  return {
    minFit: Math.floor(num("NIGHTLY_LIST_MIN_FIT", 25, 0, 100)),
    maxCostPerCompanyUsd: num("NIGHTLY_LIST_MAX_COST_PER_COMPANY_USD", 0.5, 0.05, 2),
    searchesPerCompany: Math.floor(num("ANTHROPIC_MAX_SEARCHES_PER_COMPANY", 3, 1, 5)),
  };
}
export type ResearchLimits = ReturnType<typeof researchLimits>;

export type ResearchAgent = (prompt: string, options: { model: string; maxSearches: number; maxTokens?: number; signal?: AbortSignal }, recorder?: UsageRecorder) => Promise<{ json: unknown; seen: SeenSource[] }>;
export type RepairAgent = (prompt: string, options: { model: string; maxTokens?: number; signal?: AbortSignal }, recorder?: UsageRecorder) => Promise<unknown>;
export type ResearchDeps = {
  agent: ResearchAgent;
  /** The one cheap, tool-free call that rewrites copy which failed its checks. */
  repair: RepairAgent;
  /** Null when Hunter is not configured. */
  findEmail: ((fullName: string, domain: string) => Promise<FoundEmail | null>) | null;
  verifyEmail: ((email: string) => Promise<VerifyResult>) | null;
  mailHost: (domain: string) => Promise<boolean | null>;
  fetcher?: Fetcher;
  lookup?: Lookup;
  now: Date;
  signal?: AbortSignal;
  /** Extra names the workflow copy may contain, beyond the systems the evidence confirmed. */
  knownNames: string[];
  limits: ResearchLimits;
};
export type ResearchResult = { row?: ListRow; offer?: ListOffer; skip?: string; cost: number; fit?: AiFit; verdict?: Verdict; aborted?: boolean; searches: number };

export function defaultResearchDeps(): ResearchDeps {
  const hunter = verifierConfigured();
  return {
    agent: runGroundedSearchAgent, repair: runWritingAgent, findEmail: hunter ? findEmail : null, verifyEmail: hunter ? verifyEmail : null,
    mailHost: domainAcceptsMail, now: new Date(), knownNames: [], limits: researchLimits(),
  };
}

const ownerKey = (owner: Owner) => (owner === "josh" ? "josh" : "suuchi");

// ---------- exclusions and the buyer ----------

/** Whole kinds of business Nine-67 does not sell to. Matched on the sector only, never the company name. */
const EXCLUDED = /\b(?:(?:management|it|marketing|staffing|business) consult(?:ing|ancy)|consulting firm|advisory firm|software|saas|it services|managed (?:it )?services?(?: provider)?|staffing|recruit(?:ing|ment) (?:firm|agency)|(?:marketing|advertising|digital|creative|insurance|staffing) agency|insurance (?:carrier|broker(?:age)?|company)|bank(?:ing)?|private equity|investment (?:firm|bank(?:ing)?|management|advis[eo]rs?)|venture capital|capital (?:partners|management)|non-?profit|charitable foundation|university|college|k-12|school district|hospital|health system)\b/i;

export function isExcludedSector(sector: string | null | undefined): boolean {
  return EXCLUDED.test(sector ?? "");
}

const BUYER_TITLE = /\b(ceo|chief executive|president|coo|chief operating|owner|founder|co-founder|managing (director|partner)|general manager|principal)\b/i;
const NOT_BUYER_TITLE = /\b(former|retired|emeritus|vice[ -]president|vp|assistant|interim|acting)\b|\bex-/i;
/** At $10M to $50M the operations leader often owns the work: VP or Director of Operations. */
const OPERATIONS_LEADER = /\b(?:(?:senior |sr\.? )?(?:vp|vice[ -]president|director)\b[^;|]{0,12}\boperations|operations director)\b/i;
const NOT_CURRENT = /\b(former|retired|emeritus|assistant|interim|acting)\b|\bex-/i;

/** Why this title is not a current senior leader, or null when it is. */
export function buyerTitleProblem(title: string): string | null {
  if (OPERATIONS_LEADER.test(title)) return NOT_CURRENT.test(title) ? `"${title}" is not a current senior leader` : null;
  if (!BUYER_TITLE.test(title)) return `"${title}" is not a CEO, president, COO, owner, founder, general manager or operations leader`;
  if (NOT_BUYER_TITLE.test(title)) return `"${title}" is not a current senior leader`;
  return null;
}

const DAY = 86_400_000;

/**
 * The buyer's page must be on the company's domain or one the search returned. An off-domain page the search
 * dated over two years ago keeps the row, held for a person to check.
 */
export function buyerSourceCheck(url: string, domain: string, seen: Map<string, SeenSource>, now: Date): { skip: string } | { hold: string | null } {
  if (onDomain(url, domain)) return { hold: null };
  const source = seen.get(normalizeUrl(url));
  if (!source) return { skip: "buyer source not seen" };
  const date = pageAgeDate(source.page_age, now);
  if (date && now.getTime() - Date.parse(`${date}T00:00:00Z`) > 730 * DAY) return { hold: `the buyer's only source is dated ${date.slice(0, 7)}, over two years ago` };
  return { hold: null };
}

/** Hunter's own record of the address says it may not be this buyer's: another title, or gone from every page it was seen on. */
export function hunterIdentityHold(found: Pick<FoundEmail, "position" | "sources">): string | null {
  if (found.position && buyerTitleProblem(found.position)) return `Hunter lists this address under "${found.position}", not a senior leader`;
  if (found.sources.length && found.sources.every((source) => source.still_on_page === false)) return "Hunter no longer finds this address on any page it was seen on";
  return null;
}

// ---------- research output ----------

const reject = z.object({ reject: z.string().min(2) });
const present = (value: unknown) => value ?? {};
const researched = z.object({
  sector: z.string().default("").catch(""),
  revenue: z.object({ usdMillions: z.number(), year: z.number().int(), sourceUrl: z.string().url() }).nullish(),
  // Headcount stands in for revenue when none is published.
  size: z.object({ employees: z.number().int().positive(), sourceUrl: z.string().url() }).nullish().catch(null),
  buyer: z.preprocess(present, z.object({ name: z.string().min(3), title: z.string().min(2), sourceUrl: z.string().url() })),
  email: z.object({ address: z.string().nullable().default(null), sourceUrl: z.string().nullable().default(null) }).nullable().default(null).catch(null),
  trigger: z.object({ fact: z.string().min(10), sourceUrl: z.string().url(), date: z.string().nullable().default(null) }).nullable().default(null).catch(null),
  workflow: z.preprocess(present, z.object({ task: z.string(), subject: z.string(), inputs: z.string(), metric: z.string() })),
  evidence: aiFitEvidence.default({ hiring: [], scale: null, change: [], techOpenness: [], systems: [], disqualifiers: [] }),
});
export type Researched = z.infer<typeof researched>;

/** The reject branch first, then the full shape. A failure names only the paths, not zod's whole union error. */
export function parseResearch(raw: unknown): { reject: string } | { found: Researched } | { problem: string } {
  const rejected = reject.safeParse(raw);
  if (rejected.success) return { reject: rejected.data.reject };
  const full = researched.safeParse(raw);
  if (full.success) return { found: full.data };
  const paths = [...new Set(full.error.issues.map((issue) => issue.path.join(".") || "(root)"))].slice(0, 6);
  return { problem: `research output invalid at ${paths.join(", ")}` };
}

// ---------- revenue ----------

const yearOf = (listDate: string) => Number(listDate.slice(0, 4));

/** The ranking's figure is recent and cited, so research need not spend a search finding it again. */
export function sourcedRevenueUsable(candidate: Candidate, listDate: string): boolean {
  const year = yearOf(listDate);
  return candidate.revenue_usd_m !== null && candidate.revenue_year !== null && Boolean(candidate.source_url) && candidate.revenue_year >= year - 3 && candidate.revenue_year <= year;
}

/**
 * "estimated" rows are sized by headcount because no revenue is published: usdMillions is a rough figure used
 * only to order the list, and every label shows the headcount instead.
 */
export type RowRevenue = { usdMillions: number; year: number; status: "reported" | "unconfirmed" | "estimated"; sourceUrl: string; note: string; employees?: number };
/** A deliberately rough revenue per employee for this segment, only to rank headcount-sized rows among the rest. */
const REVENUE_PER_EMPLOYEE_M = 0.15;

const disagree = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-9, Math.min(a, b)) > 0.35;

/**
 * The revenue a row carries. Research's figure when it gave one, else the ranking's. "reported" only when
 * the two agree and come from different pages; anything else is "unconfirmed" and the note says so.
 */
export function settleRevenue(candidate: Candidate, found: Researched["revenue"], listDate: string, size?: Researched["size"]): { revenue: RowRevenue; limitations: string[] } | { problem: string } {
  const current = yearOf(listDate);
  const sourced = candidate.revenue_usd_m !== null && candidate.revenue_year !== null && candidate.source_url
    ? { usdMillions: candidate.revenue_usd_m, year: candidate.revenue_year, sourceUrl: candidate.source_url } : null;
  const primary = found ?? sourced;
  // No usable published revenue: a headcount in the band sizes the company instead.
  const bySize = (why: string): { revenue: RowRevenue; limitations: string[] } | { problem: string } => {
    if (!size) return { problem: why };
    if (!inHeadcountBand(size.employees)) return { problem: `${why}; headcount ${size.employees} is outside ${HEADCOUNT_BAND.min} to ${HEADCOUNT_BAND.max}` };
    return {
      revenue: { usdMillions: Number((size.employees * REVENUE_PER_EMPLOYEE_M).toFixed(1)), year: current, status: "estimated", sourceUrl: size.sourceUrl, employees: size.employees, note: `Sized by headcount: about ${size.employees} employees. No revenue figure is published. Size does not establish budget or buying intent.` },
      limitations: [`Revenue is not published; sized by headcount (about ${size.employees} employees).`],
    };
  };
  if (!primary) return bySize("no published revenue");
  if (primary.year > current || primary.year < current - 3) return bySize(`revenue year ${primary.year} is outside ${current - 3} to ${current}`);
  if (!inRevenueBand(primary.usdMillions)) return { problem: `revenue $${primary.usdMillions}M is outside ${REVENUE_BAND_TEXT}` };
  const limitations: string[] = [];
  const ranked = candidate.revenue_usd_m;
  const split = Boolean(found && ranked !== null && disagree(ranked, found.usdMillions));
  if (split && ranked !== null && found) {
    if (!inRevenueBand(ranked)) return { problem: `ranking revenue $${ranked}M is outside ${REVENUE_BAND_TEXT}` };
    limitations.push(`Ranking lists $${ranked}M for ${candidate.revenue_year ?? "an unstated year"}; research found $${found.usdMillions}M.`);
  }
  const twoPages = Boolean(found && candidate.source_url && normalizeUrl(found.sourceUrl) !== normalizeUrl(candidate.source_url));
  const status = found && ranked !== null && !split && twoPages ? "reported" : "unconfirmed";
  const note = status === "reported"
    ? `${primary.year} revenue reported by two sources that agree; not independently audited. Revenue fit does not establish budget or buying intent.`
    : `${primary.year} revenue from ${split ? "sources that disagree" : "a single source"}; not confirmed. Revenue fit does not establish budget or buying intent.`;
  limitations.push(status === "reported" ? `Revenue is reported for ${primary.year}, not verified current revenue.` : `Revenue for ${primary.year} is unconfirmed.`);
  return { revenue: { ...primary, status, note }, limitations };
}

/**
 * A publicly traded company: a stock ticker in the research, or a source on SEC or market-data sites. Nine-67
 * sells to privately held businesses, so these are skipped however well they score.
 */
export function publicCompanySign(research: unknown): boolean {
  const text = JSON.stringify(research ?? "");
  return /\b(?:NASDAQ|NYSE(?: American)?|NYSEAMERICAN|OTC(?:QB|QX| Markets)?|TSX)\s*:\s*[A-Z]{1,5}\b/.test(text)
    || /https?:\/\/(?:www\.)?(?:sec\.gov|finviz\.com|stocktitan\.net|seekingalpha\.com|marketbeat\.com)\b/i.test(text)
    || /\b(?:10-K|10-Q|annual report on form)\b/i.test(text);
}

// ---------- trigger ----------

type Trigger = { fact: string; sourceUrl: string; date: string | null };
const countedItem = (item: { grounding?: Grounding }) => item.grounding !== "dropped" && item.grounding !== "unverified";

/** The research's trigger when it is dated within 180 days (and not in the future), else the first change that is; null otherwise. */
export function pickTrigger(found: { trigger: Researched["trigger"]; evidence: Pick<AiFitEvidence, "change"> }, now: Date): Trigger | null {
  if (found.trigger && isFreshDate(found.trigger.date, 180, now)) return { fact: found.trigger.fact, sourceUrl: found.trigger.sourceUrl, date: found.trigger.date };
  const change = found.evidence.change.find((item) => countedItem(item) && isFreshDate(item.date, 180, now));
  return change ? { fact: change.fact, sourceUrl: change.url, date: change.date } : null;
}

// ---------- prompt ----------

export function researchPrompt(candidate: Candidate, listDate: string) {
  const year = yearOf(listDate);
  const reuse = sourcedRevenueUsable(candidate, listDate);
  const revenueStep = reuse
    ? `1. Revenue (from sourcing): $${candidate.revenue_usd_m}M for ${candidate.revenue_year} per ${candidate.source_url}. Do not search for revenue. Only correct it if another search turns up a newer figure that contradicts it; otherwise set "revenue" to null.`
    : `1. Revenue: the most recent reported annual revenue in USD millions and the year (${year - 3} or later), with the URL that states it.${candidate.source_url ? ` Start from ${candidate.source_url}${candidate.revenue_usd_m ? ` (listed at $${candidate.revenue_usd_m}M${candidate.revenue_year ? ` for ${candidate.revenue_year}` : ""})` : ""}.` : ""}`;
  return `Research ${candidate.company} (${candidate.domain}), a ${candidate.sector || "U.S. operating"} company. Nine-67 builds AI tools with operations teams, and we are preparing one short cold email to a senior leader there. Use public sources and never invent a fact, a person, an address, a date or a URL. Copy every URL exactly as a search result gave it.

${revenueStep}
2. Buyer: the current CEO, President, COO, owner, founder or general manager, or the VP or Director of Operations, with the URL of a page showing their name and current title, ideally the company's own about, team or leadership page. Not any other vice president, an assistant, or a former, retired, interim or acting leader.
3. Email: only if a public page shows that person's own business email at this company, give it as {address, sourceUrl}. Otherwise null. Never guess an address and never give a shared inbox such as info@ or sales@.
4. Trigger (optional): a public development dated in the last 180 days, such as a new location, an acquisition, a leadership change or an award, as {fact, sourceUrl, date} with the date as YYYY-MM-DD. Otherwise null.
5. AI-fit evidence. Only facts a page shows, each with its https URL, and a date (YYYY-MM-DD or YYYY-MM) where the page gives one:
   - hiring: this company's open roles doing coordination, scheduling, dispatch, estimating, quoting, admin, billing, data entry or reporting work, from its careers page or a job board. Skip ${NOT_TARGET_ROLES}, and skip field, trade, sales and engineering roles. Each item is {title, url, postedDate}.
   - scale: one object {locations, fieldWorkforce, highVolume, url}: the number of locations or branches, field staff or vehicles, or a stated volume such as jobs, orders or customers a year, with the page that shows it. Null if no page shows it.
   - change: acquisitions, new locations, a new CEO, COO or operations leader, or new investment in the last 12 months. Each item is {kind, fact, date, url}.
   - techOpenness: only statements by this company's own leaders, or facts about its own operations or technology roles, about AI, automation, technology or efficiency. Never industry commentary, trade-press opinion or a vendor's marketing. Each item is {fact, date, url}.
   - systems: business software this company names, such as field service, ERP, CRM, estimating or routing tools, or a customer portal. Each item is {name, url}.
   - disqualifiers: only these kinds, each with the page that shows it: ${DISQUALIFIER_KINDS.join(", ")}. Each item is {kind, fact, url}. A lack of public information is not a disqualifier. Put any other worry in concerns, as short strings.
   Leave a part empty rather than guess.
6. Workflow: one practical piece of work a company like this probably handles by hand that an AI tool could help with, inspired by the evidence above; do not restate the evidence. It is an idea, not a claim about them. Keep every field generic and lowercase: no numbers, no company, product, software or place names, and no "your", "their" or "our". Give: task, a short noun phrase such as "branch service follow-up"; subject, two words for an email subject, such as "branch follow-ups" (one version prefixes it with "one AI project:", which must stay within five words); inputs, what the tool would bring together, three items in one phrase such as "site inspection notes, the promised fix and evidence that it was completed"; metric, what to measure, such as "time spent chasing updates". No question marks, dashes or links in these.

Size: if no revenue figure is published, give "size" as {employees, sourceUrl}: the employee count a page states (the company's site, a job post or a profile), which must be ${HEADCOUNT_BAND.min} to ${HEADCOUNT_BAND.max}. Otherwise set "size" to null.

Return {"reject":"reason"} instead if revenue is outside ${REVENUE_BAND_TEXT} (or, with no revenue, headcount is outside ${HEADCOUNT_BAND.min} to ${HEADCOUNT_BAND.max}), the company is publicly traded, consulting, IT, software, staffing, an agency, a financial firm or a nonprofit, it has closed or been acquired, or no current senior leader can be named from a source.

Return JSON only, in this shape, filling the arrays with items as described above: {"sector":"","revenue":${reuse ? "null" : `{"usdMillions":0,"year":${year},"sourceUrl":""}`},"size":null,"buyer":{"name":"","title":"","sourceUrl":""},"email":null,"trigger":null,"evidence":{"hiring":[],"scale":null,"change":[],"techOpenness":[],"systems":[],"disqualifiers":[],"concerns":[]},"workflow":{"task":"","subject":"","inputs":"","metric":""}}`;
}

// ---------- address ----------

function recipientCheck(email: string, hunterStatus: string | null, mailHost: boolean | null, hold: string | null, now: Date): RecipientCheck {
  // A held address is recorded as unverified, so saving the check can never mark the person's address verified.
  const verified = hunterStatus === "verified" && !hold;
  const catchAll = hunterStatus === "catch_all" && !hold;
  return {
    email, level: verified ? "deliverable" : "risky", source: hunterStatus && !hunterStatus.startsWith("error") ? "hunter" : "own",
    status: verified ? "verified" : catchAll ? "catch_all" : "unverified",
    reason: hold ? `Held for a person to check: ${hold}.` : verified ? "Hunter verified this address." : catchAll ? "The domain accepts every address, so it cannot be confirmed." : "Not confirmed by Hunter.",
    suggestion: null, hunter: hunterStatus, mailHost, checkedAt: now.toISOString(),
  };
}

/**
 * Choose the address and check it, spending as few Hunter credits as possible: the published address (only
 * if it is the buyer's own) with one verify; then Hunter's finder, whose own verdict is used when it already
 * has one; then first.last with one verify.
 */
export async function chooseEmail(found: Researched, domain: string, deps: Pick<ResearchDeps, "findEmail" | "verifyEmail" | "now">, mailHost: boolean | null): Promise<Verdict | { problem: string }> {
  const at = `@${domain}`;
  const name = found.buyer.name;
  const rejected = new Set<string>();
  const verify = async (email: string) => {
    if (!deps.verifyEmail) return null;
    try { return (await deps.verifyEmail(email)).status as string; } catch (error) { return `error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 100); }
  };
  const verdict = (email: string, hunterStatus: string | null, base: Verdict["emailStatus"], source: string, note: string, hold: string | null): Verdict => {
    const check = recipientCheck(email, hunterStatus, mailHost, hold, deps.now);
    const verified = check.status === "verified";
    return { email, emailStatus: verified ? "verified" : base, emailSourceUrl: source, note: verified ? `${note} Verified by Hunter.` : note, check, identityHold: hold };
  };

  const published = found.email?.address?.trim().toLowerCase();
  if (published && published.endsWith(at) && found.email?.sourceUrl && addressMatchesPerson(published, name)) {
    const status = await verify(published);
    if (status !== "invalid") return verdict(published, status, "published_unverified", found.email.sourceUrl, "Published on the linked page.", null);
    rejected.add(published);
  }

  if (deps.findEmail) {
    let hunter: FoundEmail | null = null;
    try { hunter = await deps.findEmail(name, domain); } catch { /* Hunter unavailable: fall through to the company format. */ }
    if (hunter && hunter.email.endsWith(at) && hunter.result.status !== "invalid" && !rejected.has(hunter.email) && addressMatchesPerson(hunter.email, name)) {
      const hold = hunterIdentityHold(hunter);
      const note = "Found by Hunter's email finder.";
      if (hunter.result.status === "verified" || hunter.result.status === "catch_all") return verdict(hunter.email, hunter.result.status, "inferred", found.buyer.sourceUrl, note, hold);
      const status = await verify(hunter.email);
      if (status !== "invalid") return verdict(hunter.email, status, "inferred", found.buyer.sourceUrl, note, hold);
      rejected.add(hunter.email);
    }
  }

  const built = buildEmail(name, "first.last", domain);
  if (built && !rejected.has(built)) {
    const status = await verify(built);
    if (status !== "invalid") return verdict(built, status, "inferred", found.buyer.sourceUrl, "Built from the most common first.last format. Not confirmed.", null);
  }
  return { problem: "no deliverable address for the buyer" };
}

// ---------- grounding notes ----------

/** Zero-point reasons for evidence that did not count, so the desk shows what was and was not confirmed. */
function notCounted(evidence: AiFitEvidence): AiFitReason[] {
  const out: AiFitReason[] = [];
  const add = (criterion: AiFitCriterion, grounding: Grounding | undefined, label: string, url: string | null) => {
    if (grounding === "dropped") out.push({ criterion, points: 0, text: `Not counted, not on the cited page: ${label}`, url });
    if (grounding === "unverified") out.push({ criterion, points: 0, text: `Not counted, could not confirm: ${label}`, url });
  };
  for (const item of evidence.hiring) add("hiring", item.grounding, `hiring ${item.title}`, item.url);
  if (evidence.scale) add("scale", evidence.scale.grounding, "scale", evidence.scale.url);
  for (const item of evidence.change) add("change", item.grounding, item.fact, item.url);
  for (const item of evidence.techOpenness) add("techOpenness", item.grounding, item.fact, item.url);
  for (const item of evidence.systems) add("systems", item.grounding, `system ${item.name}`, item.url);
  return out;
}

function evidenceSummary(evidence: AiFitEvidence) {
  const lines: string[] = [];
  const hiring = evidence.hiring.filter(countedItem).map((item) => item.title);
  if (hiring.length) lines.push(`Hiring: ${hiring.slice(0, 4).join("; ")}`);
  const scale = evidence.scale && countedItem(evidence.scale) ? evidence.scale : null;
  if (scale) lines.push(`Scale: ${[scale.locations ? `${scale.locations} locations` : "", scale.fieldWorkforce ? `${scale.fieldWorkforce} field staff` : "", scale.highVolume ?? ""].filter(Boolean).join(", ")}`);
  const systems = evidence.systems.filter(countedItem).map((item) => item.name);
  if (systems.length) lines.push(`Systems: ${systems.slice(0, 4).join(", ")}`);
  return lines.join("\n");
}

// ---------- the row ----------

type RowInput = {
  candidate: Candidate; found: Researched; workflow: Workflow; verdict: Verdict; owner: Owner; listDate: string;
  variants: ListVariant[]; armId: string; fit: AiFit; revenue: RowRevenue; trigger: Trigger | null; limitations: string[]; identityHold: string | null;
};

export function listRow(input: RowInput): { row: ListRow; offer: ListOffer } {
  const { candidate, found, workflow, verdict, owner, listDate, variants, armId, fit, revenue } = input;
  const chosen = variants[0];
  const trigger = input.trigger ?? { fact: `${candidate.company}: ${found.buyer.name}, ${found.buyer.title}. Proposed area to explore: ${workflow.task}.`, sourceUrl: found.buyer.sourceUrl, date: null };
  const contact = {
    name: found.buyer.name, title: found.buyer.title, sourceUrl: found.buyer.sourceUrl, email: verdict.email, emailStatus: verdict.emailStatus,
    emailSourceUrl: verdict.emailSourceUrl, emailNote: verdict.note, emailPublishedDate: null, subject: chosen.subject, message: chosen.message,
    contact_rank: 1, contact_id: `nightly-${listDate}-${candidate.domain}`,
  };
  const row = {
    company: candidate.company, domain: candidate.domain, sector: found.sector || candidate.sector,
    revenue, trigger, reframe: workflow.task, contacts: [contact], rank: 0, researchDate: listDate, targetRole: "executive", proofKind: "owner-supplied-delivery",
    hypothesis: `Proposed workflow: ${workflow.task}. This is an outreach idea, not a confirmed internal problem.`,
    fit: fit.summary,
    // Extra fields beyond the curated shape: the scored evidence, the address check, the copy arm and any hold.
    aiFit: fit,
    emailCheck: verdict.check,
    identityHold: input.identityHold,
    variantArm: armId,
    workflow: { task: workflow.task, metric: workflow.metric },
    limitations: ["Workflow need and budget have not been confirmed.", ...input.limitations, "Researched automatically overnight; recheck the role if this company is contacted much later."],
    buyer: { name: found.buyer.name, title: found.buyer.title, sourceUrl: found.buyer.sourceUrl, email: verdict.email },
    subject: chosen.subject, message: chosen.message,
    writerKit: { accountId: `nightly-${candidate.domain}`, frame: armId, sendWave: 1, factIds: [], facts: [], review: "Generated overnight from the approved batch-3 templates.", reframe: workflow.task, avoid: [], subjectIdeas: [chosen.subject], touch1Cta: chosen.message.split("\n").at(-1) ?? "" },
    assignedOwner: ownerKey(owner),
  };
  // The JSON-inferred batch type is the contract; the object above carries every field it declares.
  return { row: row as unknown as ListRow, offer: { domain: candidate.domain, contactName: found.buyer.name, variants } as unknown as ListOffer };
}

// ---------- the step ----------

const isAbort = (error: unknown, signal?: AbortSignal) => Boolean(signal?.aborted) || (error instanceof Error && error.name === "AbortError");

/** Research one company. Never throws: a problem becomes `skip`, an abort `aborted`, both with the cost so far. */
export async function researchOne(candidate: Candidate, owner: Owner, listDate: string, overrides: Partial<ResearchDeps> = {}): Promise<ResearchResult> {
  const given = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) as Partial<ResearchDeps>;
  const deps: ResearchDeps = { ...defaultResearchDeps(), ...given };
  const { limits, now, signal } = deps;
  let cost = 0;
  const budget = researchBudget(limits.searchesPerCompany, limits.maxCostPerCompanyUsd);
  const recorder = withBudget((value) => { cost += value; }, budget);
  const searches = () => limits.searchesPerCompany - budget.searchesLeft;
  const done = (result: Omit<ResearchResult, "cost" | "searches">): ResearchResult => {
    const out = { ...result, cost, searches: searches() };
    if (cost > 0) console.info(`[night-watch] research ${candidate.domain}: ${out.searches} web searches, $${cost.toFixed(4)}${result.skip ? `, skipped (${result.skip})` : ""}`);
    return out;
  };
  try {
    const mailHost = await deps.mailHost(candidate.domain).catch(() => null);
    if (mailHost === false) return done({ skip: `${candidate.domain} does not accept email` });

    const { json, seen: sources } = await deps.agent(researchPrompt(candidate, listDate), { model: researchModel(), maxSearches: limits.searchesPerCompany, maxTokens: 6_000, signal }, recorder);
    const parsed = parseResearch(json);
    if ("reject" in parsed) return done({ skip: `rejected: ${parsed.reject}` });
    if ("problem" in parsed) return done({ skip: parsed.problem });
    const found = parsed.found;

    if (publicCompanySign(json)) return done({ skip: "public company: Nine-67 sells to privately held businesses" });
    const money = settleRevenue(candidate, found.revenue, listDate, found.size);
    if ("problem" in money) return done({ skip: money.problem });
    if (!isLikelyPersonName(found.buyer.name)) return done({ skip: `"${found.buyer.name}" is not a person's name` });
    const title = buyerTitleProblem(found.buyer.title);
    if (title) return done({ skip: title });
    if (isExcludedSector(found.sector)) return done({ skip: "excluded sector" });

    const seen = new Map<string, SeenSource>();
    for (const source of [...sources, ...(candidate.source_url ? [{ url: candidate.source_url, title: null, page_age: null }] : [])]) {
      const key = normalizeUrl(source.url);
      if (!seen.has(key) || (!seen.get(key)?.page_age && source.page_age)) seen.set(key, source);
    }
    const buyerSource = buyerSourceCheck(found.buyer.sourceUrl, candidate.domain, seen, now);
    if ("skip" in buyerSource) return done({ skip: buyerSource.skip });

    const grounded = await groundEvidence(found.evidence, { seen: seen.values(), domain: candidate.domain, sourceUrl: candidate.source_url, fetcher: deps.fetcher, lookup: deps.lookup, now });
    const scored = aiFitScore(grounded.evidence, { domain: candidate.domain, now });
    const fit: AiFit = { ...scored, reasons: [...scored.reasons, ...notCounted(grounded.evidence)] };
    if (fit.disqualified) return done({ skip: `not an AI fit: ${fit.disqualified}`, fit });
    if (fit.score < limits.minFit) return done({ skip: `AI fit ${fit.score} is below ${limits.minFit}`, fit });

    const evidence = grounded.evidence;
    const allowedNames = [...evidence.systems.filter(countedItem).map((item) => item.name), ...deps.knownNames];
    const company = speakableCompany(candidate.company);
    const context = { company: candidate.company, domain: candidate.domain, allowedNames };
    let checked = checkWorkflow(found.workflow, context);
    if ("problem" in checked) checked = checkWorkflow(normalizeWorkflow(found.workflow), context);
    let workflow = "workflow" in checked ? checked.workflow : found.workflow;
    let variants = "workflow" in checked ? listVariants(company, workflow) : [];
    const problems = "problem" in checked ? [checked.problem] : variantProblems(variants, undefined, company);
    if (problems.length) {
      const writer = (prompt: string) => deps.repair(prompt, { model: researchModel(), maxTokens: 400, signal }, recorder);
      const repaired = await repairWorkflow(workflow, problems, evidenceSummary(evidence), writer, { ...context, company });
      if ("problem" in repaired) {
        if (signal?.aborted) return done({ aborted: true, fit });
        return done({ skip: `copy failed checks after repair: ${repaired.problem}`.slice(0, 300), fit });
      }
      workflow = repaired.workflow;
      variants = repaired.variants;
    }
    const arm = chooseArm(candidate.domain, variants);

    const verdict = await chooseEmail(found, candidate.domain, deps, mailHost);
    if ("problem" in verdict) return done({ skip: verdict.problem, fit });
    const identityHold = "hold" in buyerSource && buyerSource.hold ? buyerSource.hold : verdict.identityHold;
    const finalVerdict = identityHold && !verdict.identityHold
      ? { ...verdict, identityHold, emailStatus: verdict.emailStatus === "verified" ? "inferred" as const : verdict.emailStatus, check: recipientCheck(verdict.email, verdict.check.hunter, mailHost, identityHold, now) }
      : verdict;
    const limitations = [...money.limitations, ...grounded.limitations, ...(identityHold ? [`Held for a person: ${identityHold}.`] : [])];
    const built = listRow({
      candidate, found, workflow, verdict: finalVerdict, owner, listDate, variants: arm.variants, armId: arm.armId ?? arm.variants[0].id, fit,
      revenue: money.revenue, trigger: pickTrigger({ trigger: found.trigger, evidence }, now), limitations, identityHold,
    });
    return done({ ...built, verdict: finalVerdict, fit });
  } catch (error) {
    if (isAbort(error, signal)) return done({ aborted: true });
    return done({ skip: `research failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) });
  }
}
