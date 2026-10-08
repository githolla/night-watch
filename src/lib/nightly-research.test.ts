import assert from "node:assert/strict";
import test from "node:test";
import type { UsageRecorder } from "./anthropic-cost.ts";
import type { FoundEmail, VerifyResult } from "./email-verify.ts";
import type { Fetcher, SeenSource } from "./evidence-grounding.ts";
import {
  buyerTitleProblem, chooseEmail, isExcludedSector, parseResearch, pickTrigger, researchOne, researchPrompt, settleRevenue,
  type Candidate, type ResearchDeps, type ResearchResult,
} from "./nightly-research.ts";

const NOW = new Date("2026-10-01T06:00:00Z");
const LIST_DATE = "2026-10-01";

const candidate: Candidate = {
  id: "c1", company: "Acme Landscaping, LLC", domain: "acmeland.com", sector: "commercial landscaping",
  revenue_usd_m: 45, revenue_year: 2025, source_url: "https://rank.example.com/lm150", sector_key: 1,
};

type Json = Record<string, unknown>;
function research(overrides: Json = {}): Json {
  return {
    sector: "commercial landscaping",
    revenue: { usdMillions: 46, year: 2025, sourceUrl: "https://bizjournal.example.com/acme" },
    buyer: { name: "John Smith", title: "President & CEO", sourceUrl: "https://acmeland.com/about" },
    email: null,
    trigger: null,
    evidence: {
      hiring: [
        { title: "Dispatch Coordinator", url: "https://acmeland.com/careers/dispatch", postedDate: "2026-09-10" },
        { title: "Billing Clerk", url: "https://acmeland.com/careers/billing", postedDate: "2026-09-01" },
      ],
      scale: { locations: 6, fieldWorkforce: 120, highVolume: null, url: "https://acmeland.com/locations" },
      change: [{ kind: "acquisition", fact: "Acme acquired Green Turf Services in August 2026", date: "2026-08-15", url: "https://news.example.com/acme-acquires" }],
      techOpenness: [],
      systems: [{ name: "Aspire", url: "https://acmeland.com/careers/dispatch" }],
      disqualifiers: [],
    },
    workflow: { task: "crew schedule changes", subject: "crew schedules", inputs: "crew calendars, client requests and site notes", metric: "time spent rescheduling crews" },
    ...overrides,
  };
}

const SEEN: SeenSource[] = [
  "https://bizjournal.example.com/acme", "https://acmeland.com/careers/dispatch", "https://acmeland.com/careers/billing",
  "https://acmeland.com/locations", "https://news.example.com/acme-acquires",
].map((url) => ({ url, title: null, page_age: null }));

const notFound: Fetcher = async () => new Response("gone", { status: 404 });

function harness(json: unknown, options: { seen?: SeenSource[]; find?: FoundEmail | null; verify?: (email: string) => VerifyResult["status"]; repair?: unknown[]; mailHost?: boolean | null; agentCost?: number } = {}) {
  const calls = { agent: 0, find: 0, verify: [] as string[], repair: 0, maxSearches: [] as number[] };
  const repairs = [...(options.repair ?? [])];
  const deps: Partial<ResearchDeps> = {
    now: NOW,
    limits: { minFit: 40, maxCostPerCompanyUsd: 0.5, searchesPerCompany: 3 },
    mailHost: async () => (options.mailHost === undefined ? true : options.mailHost),
    agent: async (_prompt, agentOptions, recorder?: UsageRecorder) => {
      calls.agent += 1;
      calls.maxSearches.push(agentOptions.maxSearches);
      recorder?.(options.agentCost ?? 0.05);
      return { json, seen: options.seen ?? SEEN };
    },
    repair: async (_prompt, _options, recorder?: UsageRecorder) => {
      calls.repair += 1;
      recorder?.(0.01);
      return repairs.shift() ?? null;
    },
    findEmail: async () => { calls.find += 1; return options.find ?? null; },
    verifyEmail: async (email) => { calls.verify.push(email); return { status: options.verify?.(email) ?? "verified", score: 90 }; },
    fetcher: notFound,
    lookup: async () => ["93.184.216.34"],
    knownNames: [],
  };
  return { deps, calls };
}

type Row = Record<string, unknown> & { writerKit: Record<string, unknown>; revenue: Record<string, unknown>; trigger: Record<string, unknown>; contacts: Array<Record<string, unknown>>; limitations: string[]; emailCheck: Record<string, unknown> };
const rowOf = (result: ResearchResult) => {
  assert.ok(result.row, `expected a row, got skip: ${result.skip}`);
  return result.row as unknown as Row;
};

const TODAY_KEYS = ["company", "domain", "sector", "revenue", "trigger", "reframe", "contacts", "rank", "researchDate", "targetRole", "proofKind", "hypothesis", "fit", "aiFit", "emailCheck", "limitations", "buyer", "subject", "message", "writerKit", "assignedOwner"];

test("clean research becomes a row with every field today's rows carry", async () => {
  const { deps, calls } = harness(research());
  const result = await researchOne(candidate, "josh", LIST_DATE, deps);
  const row = rowOf(result);
  for (const key of TODAY_KEYS) assert.ok(key in row, `missing ${key}`);
  assert.equal(calls.agent, 1);
  assert.equal(result.cost, 0.05);
  assert.equal(row.company, "Acme Landscaping, LLC", "the full legal name stays on the row");
  assert.match(String(row.message), /Acme Landscaping\b/);
  assert.doesNotMatch(String(row.message), /LLC/);
  assert.equal(row.writerKit.frame, row.variantArm);
  assert.ok(["direct-offer", "concrete-idea"].includes(String(row.variantArm)));
  assert.deepEqual(row.workflow, { task: "crew schedule changes", metric: "time spent rescheduling crews" });
  assert.equal(row.identityHold, null);
  assert.equal(row.revenue.status, "reported", "45 and 46 agree, from different pages");
  assert.equal(row.trigger.date, "2026-08-15", "a fresh change item is the trigger");
  const offer = result.offer as unknown as { variants: Array<{ id: string; subject: string }> };
  assert.equal(offer.variants[0].id, row.variantArm);
  assert.equal(row.subject, offer.variants[0].subject);
  assert.equal(row.contacts[0].email, "john.smith@acmeland.com");
});

test("the copy arm splits evenly and never auto-picks delivery-experience", async () => {
  const arms = new Map<string, number>();
  for (let index = 0; index < 40; index++) {
    const { deps } = harness(research({ buyer: { name: "John Smith", title: "Owner", sourceUrl: `https://acme${index}.com/about` } }));
    const row = rowOf(await researchOne({ ...candidate, domain: `acme${index}.com` }, "suuchi", LIST_DATE, deps));
    arms.set(String(row.variantArm), (arms.get(String(row.variantArm)) ?? 0) + 1);
  }
  assert.ok(!arms.has("delivery-experience"));
  assert.ok((arms.get("direct-offer") ?? 0) >= 10 && (arms.get("concrete-idea") ?? 0) >= 10, JSON.stringify([...arms]));
});

test("an aborted research call reports aborted with the cost so far", async () => {
  const { deps } = harness(research());
  const result = await researchOne(candidate, "josh", LIST_DATE, {
    ...deps,
    agent: async (_prompt, _options, recorder) => { recorder?.(0.02); const error = new Error("aborted"); error.name = "AbortError"; throw error; },
  });
  assert.equal(result.aborted, true);
  assert.equal(result.cost, 0.02);
  assert.equal(result.row, undefined);
});

test("a buyer page that was neither on the domain nor returned by a search is skipped", async () => {
  const { deps } = harness(research({ buyer: { name: "John Smith", title: "CEO", sourceUrl: "https://people-directory.example.org/john-smith" } }));
  const result = await researchOne(candidate, "josh", LIST_DATE, deps);
  assert.equal(result.skip, "buyer source not seen");
});

test("an off-domain buyer page the search dated over two years ago keeps the row, held", async () => {
  const buyerUrl = "https://bizjournal.example.com/2023/acme-names-ceo";
  const { deps } = harness(research({ buyer: { name: "John Smith", title: "CEO", sourceUrl: buyerUrl } }), { seen: [...SEEN, { url: buyerUrl, title: null, page_age: "2023-01-15" }] });
  const row = rowOf(await researchOne(candidate, "josh", LIST_DATE, deps));
  assert.match(String(row.identityHold), /2023-01/);
  assert.notEqual(row.emailCheck.status, "verified");
  assert.equal(row.emailCheck.level, "risky");
});

test("invented evidence links that 404 earn nothing and the company is skipped", async () => {
  const invented = research({
    revenue: { usdMillions: 46, year: 2025, sourceUrl: "https://bizjournal.example.com/acme" },
    evidence: {
      hiring: [{ title: "Dispatch Coordinator", url: "https://acmeland.com/jobs/made-up", postedDate: "2026-09-10" }],
      scale: { locations: 6, fieldWorkforce: 120, highVolume: null, url: "https://acmeland.com/made-up" },
      change: [{ kind: "acquisition", fact: "Acme acquired a rival company recently", date: "2026-08-15", url: "https://news.example.com/made-up" }],
      techOpenness: [], systems: [], disqualifiers: [],
    },
  });
  const { deps } = harness(invented, { seen: [] });
  const result = await researchOne(candidate, "josh", LIST_DATE, deps);
  assert.equal(result.fit?.score, 0);
  assert.equal(result.skip, "AI fit 0 is below 40");
  assert.ok(result.fit?.reasons.some((reason) => reason.points === 0 && /Not counted/.test(reason.text)));
});

test("the buyer's title must be a current senior leader", async () => {
  assert.equal(buyerTitleProblem("President & CEO"), null);
  assert.equal(buyerTitleProblem("Owner"), null);
  assert.equal(buyerTitleProblem("Co-Founder and Managing Partner"), null);
  assert.ok(buyerTitleProblem("Former President"));
  assert.ok(buyerTitleProblem("Vice President of Sales"));
  assert.ok(buyerTitleProblem("Interim CEO"));
  assert.ok(buyerTitleProblem("Executive Assistant to the President"));
  for (const title of ["Former President", "Vice President of Sales"]) {
    const { deps } = harness(research({ buyer: { name: "John Smith", title, sourceUrl: "https://acmeland.com/about" } }));
    const result = await researchOne(candidate, "josh", LIST_DATE, deps);
    assert.match(String(result.skip), /not a (current senior leader|CEO)/);
  }
});

test("a shared inbox is never chosen, even when Hunter verifies it", async () => {
  const { deps, calls } = harness(research({ email: { address: "info@acmeland.com", sourceUrl: "https://acmeland.com/contact" } }), {
    find: { email: "jsmith@acmeland.com", result: { status: "verified", score: 95 }, position: "CEO", sources: [] },
  });
  const row = rowOf(await researchOne(candidate, "josh", LIST_DATE, deps));
  assert.equal(row.contacts[0].email, "jsmith@acmeland.com");
  assert.ok(!calls.verify.includes("info@acmeland.com"));
});

test("Hunter's own record of the address can hold a row for a person", async () => {
  const gone = { email: "jsmith@acmeland.com", result: { status: "verified" as const, score: 95 }, position: "CEO", sources: [{ uri: "https://a.example.com", still_on_page: false }, { uri: "https://b.example.com", still_on_page: false }] };
  let { deps } = harness(research(), { find: gone });
  let row = rowOf(await researchOne(candidate, "josh", LIST_DATE, deps));
  assert.match(String(row.identityHold), /no longer finds/);
  assert.notEqual(row.emailCheck.status, "verified");
  assert.notEqual(row.contacts[0].emailStatus, "verified");

  ({ deps } = harness(research(), { find: { ...gone, sources: [] } }));
  row = rowOf(await researchOne(candidate, "josh", LIST_DATE, deps));
  assert.equal(row.identityHold, null);
  assert.equal(row.emailCheck.status, "verified");

  ({ deps } = harness(research(), { find: { ...gone, sources: [], position: "Sales Manager" } }));
  row = rowOf(await researchOne(candidate, "josh", LIST_DATE, deps));
  assert.match(String(row.identityHold), /Sales Manager/);
});

test("a malformed trigger keeps the row; a missing buyer names the path", async () => {
  const { deps } = harness(research({ trigger: { fact: "short", sourceUrl: "not a link" } }));
  const row = rowOf(await researchOne(candidate, "josh", LIST_DATE, deps));
  assert.ok(row.trigger);
  const parsed = parseResearch(research({ trigger: { fact: "x" } }));
  assert.ok("found" in parsed && parsed.found.trigger === null);

  const missing = research();
  delete missing.buyer;
  const { deps: missingDeps } = harness(missing);
  const result = await researchOne(candidate, "josh", LIST_DATE, missingDeps);
  assert.match(String(result.skip), /^research output invalid at .*buyer\.name/);
  assert.deepEqual(parseResearch({ reject: "a software company" }), { reject: "a software company" });
});

test("sector exclusion uses whole-business phrases on the sector only", () => {
  for (const sector of ["foundation repair contractor", "insurance restoration", "investment castings", "food marketing and distribution", "school bus contractor", "electrical contractor"]) {
    assert.equal(isExcludedSector(sector), false, sector);
  }
  for (const sector of ["IT managed services", "insurance agency", "marketing agency", "management consulting", "staffing", "regional bank"]) {
    assert.equal(isExcludedSector(sector), true, sector);
  }
});

test("Capital Electric is researched, not excluded by its name", async () => {
  const { deps } = harness(research({ sector: "electrical contractor", buyer: { name: "John Smith", title: "Owner", sourceUrl: "https://capitalelectric.com/about" } }));
  const row = rowOf(await researchOne({ ...candidate, company: "Capital Electric", domain: "capitalelectric.com" }, "josh", LIST_DATE, deps));
  assert.equal(row.company, "Capital Electric");
});

test("only a fresh trigger or change is used; stale and future dates fall back", () => {
  const stale = { trigger: null, evidence: { change: [{ kind: "acquisition", fact: "Acme acquired a rival company", date: "2025-08-27", url: "https://n.example.com/a" }] } };
  assert.equal(pickTrigger(stale, NOW), null);
  const future = { trigger: { fact: "Acme will open a new branch in Dallas", sourceUrl: "https://n.example.com/b", date: "2027-03-01" }, evidence: { change: [] } };
  assert.equal(pickTrigger(future, NOW), null);
  const fresh = { trigger: null, evidence: { change: [stale.evidence.change[0], { kind: "new location", fact: "Acme opened a branch in Austin", date: "2026-07-01", url: "https://n.example.com/c" }] } };
  assert.equal(pickTrigger(fresh, NOW)?.date, "2026-07-01");
});

test("a 400-day-old change with no trigger falls back to the buyer and workflow line", async () => {
  const old = research();
  (old.evidence as Json).change = [{ kind: "acquisition", fact: "Acme acquired Green Turf Services in August 2025", date: "2025-08-27", url: "https://news.example.com/acme-acquires" }];
  const { deps } = harness(old);
  const row = rowOf(await researchOne(candidate, "josh", LIST_DATE, deps));
  assert.equal(row.trigger.date, null);
  assert.match(String(row.trigger.fact), /Proposed area to explore/);
});

test("revenue: bounded year, ranking disagreement, status and merging", () => {
  const found = (usdMillions: number, year = 2025, sourceUrl = "https://bizjournal.example.com/acme") => ({ usdMillions, year, sourceUrl });
  assert.match(String((settleRevenue(candidate, found(45, 2017), LIST_DATE) as { problem: string }).problem), /2017/);
  assert.ok("problem" in settleRevenue(candidate, found(45, 2027), LIST_DATE));
  assert.match(String((settleRevenue(candidate, found(60), LIST_DATE) as { problem: string }).problem), /outside \$10M to \$50M/);

  const split = settleRevenue({ ...candidate, revenue_usd_m: 18 }, found(42), LIST_DATE);
  assert.ok("revenue" in split);
  assert.equal(split.revenue.status, "unconfirmed");
  assert.ok(split.limitations.some((line) => line.includes("Ranking lists $18M for 2025; research found $42M")));
  assert.match(split.revenue.note, /disagree/);

  const agree = settleRevenue(candidate, found(46), LIST_DATE);
  assert.ok("revenue" in agree && agree.revenue.status === "reported" && /two sources/.test(agree.revenue.note));
  const samePage = settleRevenue(candidate, found(46, 2025, "https://rank.example.com/lm150/"), LIST_DATE);
  assert.ok("revenue" in samePage && samePage.revenue.status === "unconfirmed");

  const merged = settleRevenue(candidate, null, LIST_DATE);
  assert.ok("revenue" in merged && merged.revenue.usdMillions === 45 && merged.revenue.sourceUrl === candidate.source_url && merged.revenue.status === "unconfirmed");
  assert.ok("problem" in settleRevenue({ ...candidate, revenue_usd_m: null }, null, LIST_DATE));
});

test("research that omits revenue uses the sourced figure", async () => {
  const { deps } = harness(research({ revenue: null }));
  const row = rowOf(await researchOne(candidate, "josh", LIST_DATE, deps));
  assert.equal(row.revenue.usdMillions, 45);
  assert.equal(row.revenue.status, "unconfirmed");
});

test("the prompt skips the revenue search when sourcing already has a recent cited figure", () => {
  const reuse = researchPrompt(candidate, LIST_DATE);
  assert.match(reuse, /Do not search for revenue/);
  assert.doesNotMatch(reuse, /the most recent reported annual revenue/);
  const search = researchPrompt({ ...candidate, revenue_year: 2021 }, LIST_DATE);
  assert.match(search, /the most recent reported annual revenue/);
  assert.match(researchPrompt({ ...candidate, source_url: null }, LIST_DATE), /the most recent reported annual revenue/);
});

test("the prompt carries the tightened rules and no placeholder items", () => {
  const prompt = researchPrompt(candidate, LIST_DATE);
  assert.ok(!prompt.includes('"url":"https://..."'));
  assert.ok(prompt.includes('"hiring":[]'));
  for (const phrase of ["inspired by the evidence above; do not restate the evidence", "no numbers", "this company's own leaders", "Never industry commentary", "machine learning engineer", "A lack of public information is not a disqualifier", "software_or_it", "Not a vice president"]) {
    assert.ok(prompt.includes(phrase), phrase);
  }
});

test("research runs with the default three searches", async () => {
  const saved = process.env.ANTHROPIC_MAX_SEARCHES_PER_COMPANY;
  delete process.env.ANTHROPIC_MAX_SEARCHES_PER_COMPANY;
  try {
    const { deps, calls } = harness(research());
    await researchOne(candidate, "josh", LIST_DATE, { ...deps, limits: undefined });
    assert.deepEqual(calls.maxSearches, [3]);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_MAX_SEARCHES_PER_COMPANY = saved;
  }
});

test("the address is chosen with as few Hunter calls as possible", async () => {
  const parsed = parseResearch(research({ email: { address: "john.smith@acmeland.com", sourceUrl: "https://acmeland.com/team" } }));
  assert.ok("found" in parsed);
  const noPublished = parseResearch(research());
  assert.ok("found" in noPublished);
  const count = () => ({ find: 0, verify: 0 });

  let calls = count();
  let verdict = await chooseEmail(parsed.found, "acmeland.com", { now: NOW, findEmail: async () => { calls.find++; return null; }, verifyEmail: async () => { calls.verify++; return { status: "verified", score: 90 }; } }, true);
  assert.deepEqual(calls, { find: 0, verify: 1 }, "published and valid");
  assert.ok("email" in verdict && verdict.email === "john.smith@acmeland.com");

  calls = count();
  verdict = await chooseEmail(noPublished.found, "acmeland.com", { now: NOW, findEmail: async () => { calls.find++; return { email: "jsmith@acmeland.com", result: { status: "verified", score: 95 }, position: null, sources: [] }; }, verifyEmail: async () => { calls.verify++; return { status: "verified", score: 90 }; } }, true);
  assert.deepEqual(calls, { find: 1, verify: 0 }, "no published address, finder verified");
  assert.ok("check" in verdict && verdict.check.status === "verified" && verdict.check.source === "hunter");

  calls = count();
  verdict = await chooseEmail(parsed.found, "acmeland.com", { now: NOW, findEmail: async () => { calls.find++; return null; }, verifyEmail: async (email) => { calls.verify++; return { status: email === "john.smith@acmeland.com" ? "invalid" : "verified", score: 90 }; } }, true);
  assert.deepEqual(calls, { find: 1, verify: 1 }, "published invalid and first.last is the same address, so it is not checked twice");
  assert.ok("problem" in verdict);

  const jsmith = parseResearch(research({ email: { address: "jsmith@acmeland.com", sourceUrl: "https://acmeland.com/team" } }));
  assert.ok("found" in jsmith);
  calls = count();
  verdict = await chooseEmail(jsmith.found, "acmeland.com", { now: NOW, findEmail: async () => { calls.find++; return null; }, verifyEmail: async (email) => { calls.verify++; return { status: email === "jsmith@acmeland.com" ? "invalid" : "verified", score: 90 }; } }, true);
  assert.deepEqual(calls, { find: 1, verify: 2 }, "published invalid, finder empty: first.last verified once");
  assert.ok("email" in verdict && verdict.email === "john.smith@acmeland.com");
});

test("a domain that accepts no mail is skipped before any paid call", async () => {
  const { deps, calls } = harness(research(), { mailHost: false });
  const result = await researchOne(candidate, "josh", LIST_DATE, deps);
  assert.match(String(result.skip), /does not accept email/);
  assert.deepEqual({ agent: calls.agent, find: calls.find, verify: calls.verify.length }, { agent: 0, find: 0, verify: 0 });
  assert.equal(result.cost, 0);
});

test("copy that fails its checks is repaired once, on the company's budget", async () => {
  const long = research({ workflow: { task: "crew schedule changes", subject: "a much longer subject line than five words allows", inputs: "crew calendars, client requests and site notes", metric: "time spent rescheduling crews" } });
  const fixed = { task: "crew schedule changes", subject: "crew schedules", inputs: "crew calendars, client requests and site notes", metric: "time spent rescheduling crews" };
  let { deps, calls } = harness(long, { repair: [fixed] });
  const result = await researchOne(candidate, "josh", LIST_DATE, deps);
  rowOf(result);
  assert.equal(calls.repair, 1);
  assert.equal(Number(result.cost.toFixed(2)), 0.06, "the repair's cost is added");

  ({ deps, calls } = harness(long, { repair: [{ ...fixed, subject: "still a much longer subject than five words" }] }));
  const failed = await researchOne(candidate, "josh", LIST_DATE, deps);
  assert.match(String(failed.skip), /^copy failed checks after repair: /);
  assert.equal(calls.repair, 1);
});
