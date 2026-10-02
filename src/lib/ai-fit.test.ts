import assert from "node:assert/strict";
import test from "node:test";
import { AI_FIT_MAX, aiFitEvidence, aiFitScore, fitOutcomes, isAutomatableRole, isFreshDate, listOutcomes, priorScore, sectorWeights, type OutcomeTouch } from "./ai-fit.ts";

const now = new Date("2026-10-01T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
const domain = "example.com";
const url = "https://example.com/source";
const empty = { hiring: [], scale: null, change: [], techOpenness: [], systems: [], disqualifiers: [] };

test("no evidence, no score: the model cannot assert a fit", () => {
  const fit = aiFitScore(empty, { now });
  assert.equal(fit.score, 0);
  assert.equal(fit.summary, "AI fit 0/100");
  assert.deepEqual(fit.concerns, []);
  assert.equal(fit.unverified, 0);
});

test("hiring counts only roles a system could take on, and only while fresh", () => {
  const fit = aiFitScore({ ...empty, hiring: [
    { title: "Dispatcher", url, postedDate: daysAgo(10) },
    { title: "Estimator", url: "https://example.com/careers/estimator", postedDate: null },
    { title: "Sales Representative", url, postedDate: daysAgo(5) },
    { title: "Scheduling Coordinator", url, postedDate: daysAgo(200) },
  ] }, { now, domain });
  assert.equal(fit.breakdown.hiring, 12 + 6, "fresh dispatcher full, undated estimator half, sales and stale roles nothing");
  assert.ok(fit.reasons.every((reason) => reason.url));
});

test("scale, change, openness and systems each have a cap, and the total never passes 100", () => {
  const fit = aiFitScore({
    hiring: ["Billing coordinator", "Dispatcher", "Scheduling coordinator", "Data analyst"].map((title) => ({ title, url, postedDate: daysAgo(3) })),
    scale: { locations: 6, fieldWorkforce: 120, highVolume: null, url },
    change: [{ kind: "acquisition", fact: "Acquired a regional competitor in May", date: daysAgo(120), url }, { kind: "leader", fact: "Named a new COO this summer", date: daysAgo(60), url }],
    techOpenness: [{ fact: "CEO told a trade paper they are piloting AI for estimates", date: daysAgo(30), url }, { fact: "Hired a Director of Operations Technology", date: daysAgo(90), url }],
    systems: [{ name: "ServiceTitan", url }, { name: "NetSuite", url }, { name: "Salesforce", url }],
    disqualifiers: [],
  }, { now, domain });
  for (const [criterion, max] of Object.entries(AI_FIT_MAX)) assert.ok(fit.breakdown[criterion as keyof typeof AI_FIT_MAX] <= max, criterion);
  assert.equal(fit.score, 100);
  assert.match(fit.summary, /^AI fit 100\/100: /);
  assert.equal(fit.reasons.filter((reason) => reason.criterion === "systems").reduce((sum, reason) => sum + reason.points, 0), fit.breakdown.systems);
});

test("old news does not count as change", () => {
  const fit = aiFitScore({ ...empty, change: [{ kind: "acquisition", fact: "Acquired a competitor in 2023", date: daysAgo(800), url }] }, { now });
  assert.equal(fit.breakdown.change, 0);
});

// ---------- tolerant parsing ----------

test("the prompt's placeholder template parses without throwing and scores 0", () => {
  const template = { hiring: [{ title: "", url: "https://...", postedDate: null }], scale: { locations: null, fieldWorkforce: null, highVolume: null, url: null }, change: [{ kind: "", fact: "", date: null, url: "https://..." }], techOpenness: [{ fact: "", date: null, url: "https://..." }], systems: [{ name: "", url: "https://..." }], disqualifiers: [] };
  const fit = aiFitScore(template, { now, domain });
  assert.equal(fit.score, 0);
});

test("an http link drops only that item; the rest still score", () => {
  const fit = aiFitScore({ ...empty,
    hiring: [{ title: "Dispatcher", url: "http://example.com/jobs/1", postedDate: daysAgo(5) }, { title: "", url, postedDate: null }],
    change: [{ kind: "acquisition", fact: "Acquired a regional competitor in May", date: daysAgo(30), url }],
  }, { now, domain });
  assert.equal(fit.breakdown.hiring, 0);
  assert.equal(fit.breakdown.change, 14);
});

test("a placeholder https://... link is dropped, never rewritten", () => {
  const parsed = aiFitEvidence.parse({ ...empty, systems: [{ name: "ServiceTitan", url: "https://..." }, { name: "NetSuite", url: "https://example.com/stack" }] });
  assert.deepEqual(parsed.systems.map((system) => system.name), ["NetSuite"]);
});

test("a bad scale link or a non-array field never throws", () => {
  const fit = aiFitScore({ ...empty, scale: { locations: 4, url: "example.com" }, hiring: "none", systems: null }, { now, domain });
  assert.equal(fit.breakdown.scale, 0);
  assert.equal(fit.breakdown.hiring, 0);
});

test("parsing is idempotent", () => {
  const raw = { ...empty,
    hiring: [{ title: "Dispatcher", url, postedDate: "2026-09" }, { title: "x", url }],
    scale: { locations: 3, url },
    change: [{ kind: "acquisition", fact: "Acquired a regional competitor in May", date: "May 2026", url }],
    disqualifiers: ["limited public information", { kind: "software_or_it", fact: "Sells software", url: "https://x.com/about" }],
  };
  const once = aiFitEvidence.parse(raw);
  assert.deepEqual(aiFitEvidence.parse(once), once);
});

// ---------- dates, duplicates, hosts, volume ----------

test("a date far in the future scores 0; a malformed date counts as undated", () => {
  const future = aiFitScore({ ...empty, change: [{ kind: "acquisition", fact: "Acquired a regional competitor in May", date: "2099-01-01", url }] }, { now });
  assert.equal(future.breakdown.change, 0);
  const malformed = aiFitScore({ ...empty, change: [{ kind: "acquisition", fact: "Acquired a regional competitor in May", date: "last spring", url }] }, { now });
  assert.equal(malformed.breakdown.change, 7, "undated earns half of 14");
});

test("isFreshDate refuses invented future dates and old ones", () => {
  assert.equal(isFreshDate(daysAgo(10), 180, now), true);
  assert.equal(isFreshDate(daysAgo(400), 180, now), false);
  assert.equal(isFreshDate("2099-01-01", 180, now), false);
  assert.equal(isFreshDate("2026-13-01", 180, now), false);
  assert.equal(isFreshDate(null, 180, now), false);
  assert.equal(isFreshDate("2026-09", 180, now), true);
});

test("one acquisition cited three times counts once", () => {
  const fit = aiFitScore({ ...empty, change: [
    { kind: "Acquisition", fact: "Acquired Smith Plumbing, a regional competitor", date: daysAgo(30), url: "https://news.example.org/a" },
    { kind: "acquisition", fact: "Completes acquisition of Smith Plumbing", date: daysAgo(29), url: "https://trade.example.net/b" },
    { kind: "acquisition ", fact: "Smith Plumbing joins the company", date: daysAgo(31), url: "https://example.com/news" },
  ] }, { now });
  assert.equal(fit.breakdown.change, 14);
});

test("the same role on two job boards counts once", () => {
  const fit = aiFitScore({ ...empty, hiring: [
    { title: "Dispatcher", url: "https://www.indeed.com/viewjob?jk=1", postedDate: daysAgo(5) },
    { title: " dispatcher ", url: "https://boards.greenhouse.io/example/jobs/2", postedDate: daysAgo(3) },
  ] }, { now, domain });
  assert.equal(fit.breakdown.hiring, 12);
});

test("hiring links must be on the company's site or a job board", () => {
  const fit = aiFitScore({ ...empty, hiring: [
    { title: "Dispatcher", url: "https://someblog.com/post/jobs", postedDate: daysAgo(5) },
    { title: "Billing coordinator", url: "https://careers.example.com/billing", postedDate: daysAgo(5) },
    { title: "Scheduling coordinator", url: "https://www.linkedin.com/in/someone", postedDate: daysAgo(5) },
  ] }, { now, domain });
  assert.deepEqual(fit.reasons.map((reason) => reason.text), ["Hiring: Billing coordinator"]);
});

test("three distinct automatable roles earn a cluster bonus within the hiring cap", () => {
  const fit = aiFitScore({ ...empty, hiring: ["Dispatcher", "Billing coordinator", "Data analyst"].map((title) => ({ title, url, postedDate: null })) }, { now, domain });
  assert.equal(fit.breakdown.hiring, 6 * 3 + 5);
  assert.ok(fit.reasons.some((reason) => /cluster/i.test(reason.text)));
});

test("high volume needs a number and scales with it", () => {
  const score = (highVolume: string) => aiFitScore({ ...empty, scale: { locations: null, fieldWorkforce: null, highVolume, url } }, { now }).breakdown.scale;
  assert.equal(score("very high volume"), 0);
  assert.equal(score("12,000 jobs a year"), 8);
  assert.equal(score("about 400 orders a week"), 5);
  assert.equal(score("40 trucks"), 3);
});

test("a vendor homepage proves nothing; a vendor case study or job posting does", () => {
  const points = (systemUrl: string) => aiFitScore({ ...empty, systems: [{ name: "ServiceTitan", url: systemUrl }] }, { now, domain }).breakdown.systems;
  assert.equal(points("https://www.servicetitan.com/"), 0);
  assert.equal(points("https://www.servicetitan.com/customers/acme"), 8);
  assert.equal(points("https://www.indeed.com/viewjob?jk=1"), 8);
  assert.equal(points("https://example.com/"), 8, "the company's own site counts");
});

test("each system reason cites its own link", () => {
  const fit = aiFitScore({ ...empty, systems: [{ name: "ServiceTitan", url: "https://example.com/a" }, { name: "servicetitan", url: "https://example.com/b" }, { name: "NetSuite", url: "https://example.com/c" }] }, { now, domain });
  assert.deepEqual(fit.reasons.map((reason) => reason.url), ["https://example.com/a", "https://example.com/c"]);
  assert.equal(fit.breakdown.systems, 15);
});

test("dropped and unverified evidence earns nothing and unverified items are counted", () => {
  const fit = aiFitScore({ ...empty,
    hiring: [{ title: "Dispatcher", url, postedDate: daysAgo(5), grounding: "unverified" }, { title: "Billing coordinator", url, postedDate: daysAgo(5), grounding: "confirmed" }],
    systems: [{ name: "ServiceTitan", url, grounding: "dropped" }, { name: "NetSuite", url, grounding: "seen" }],
  }, { now, domain });
  assert.equal(fit.breakdown.hiring, 12);
  assert.equal(fit.breakdown.systems, 8);
  assert.equal(fit.unverified, 1);
});

// ---------- roles ----------

test("automatable roles: coordination and data seats count, engineering, science and sales do not", () => {
  const yes = ["Dispatcher", "Estimator", "Estimating Engineer", "Quote Coordinator", "Data Analyst", "Reporting Analyst", "Data Entry Clerk", "ERP Systems Analyst", "CRM Administrator", "Billing Coordinator", "Sales Coordinator", "Sales Operations Analyst"];
  const no = ["Data Scientist", "Machine Learning Engineer - Data Platform", "Data Engineer", "Systems Engineer", "Process Engineer", "Process Operator", "PLC Automation Engineer", "Database Administrator", "Systems Installer", "Quota Carrying Sales Rep", "Field Service Technician", "Customer Service Representative", "Software Developer", "Account Executive"];
  for (const title of yes) assert.equal(isAutomatableRole(title), true, title);
  for (const title of no) assert.equal(isAutomatableRole(title), false, title);
});

// ---------- disqualifiers ----------

test("a free-text worry is a concern and leaves the score alone", () => {
  const fit = aiFitScore({ ...empty, systems: [{ name: "Procore", url }], disqualifiers: ["limited public information"] }, { now, domain });
  assert.equal(fit.score, 8);
  assert.equal(fit.disqualified, null);
  assert.deepEqual(fit.concerns, ["limited public information"]);
});

test("a recognized, sourced disqualifier zeroes the score and says why", () => {
  const fit = aiFitScore({ ...empty, systems: [{ name: "Procore", url }], disqualifiers: [{ kind: "software_or_it", url: "https://x.com/about" }] }, { now, domain });
  assert.equal(fit.score, 0);
  assert.equal(fit.summary, "Not a fit: a software or IT business");
  const withFact = aiFitScore({ ...empty, disqualifiers: [{ kind: "closing_or_acquired", fact: "Acquired by a national group in August", url: "https://x.com/news" }] }, { now });
  assert.equal(withFact.disqualified, "Acquired by a national group in August");
});

test("a recognized kind without a link, or malformed disqualifiers, never zero the score or throw", () => {
  const unsourced = aiFitScore({ ...empty, systems: [{ name: "Procore", url }], disqualifiers: [{ kind: "inhouse_ai_team", fact: "Has an AI lab" }] }, { now, domain });
  assert.equal(unsourced.score, 8);
  assert.deepEqual(unsourced.concerns, ["Has an AI lab"]);
  assert.doesNotThrow(() => aiFitScore({ ...empty, disqualifiers: "software company" }, { now }));
  assert.doesNotThrow(() => aiFitScore({ ...empty, disqualifiers: [null, 3, { kind: 7 }] }, { now }));
});

// ---------- prior and learning ----------

test("the pre-score favours operations-heavy sectors, the $20M to $80M middle, and size hints", () => {
  const best = priorScore({ revenueUsdM: 45, locations: 4, fieldService: true, sectorRank: 0 });
  const edge = priorScore({ revenueUsdM: 95, locations: null, fieldService: null, sectorRank: 0 });
  const lowSector = priorScore({ revenueUsdM: 45, locations: 4, fieldService: true, sectorRank: 9 });
  assert.ok(best > edge && best > lowSector);
  assert.ok(priorScore({ revenueUsdM: 45, locations: 4, fieldService: true, sectorRank: 0, sectorWeight: 1.5 }) > best, "learned weight lifts a sector");
});

const tallies = (sector: string, sends: number, positive: number) => Array.from({ length: sends }, (_, index) => ({ sector, positive: index < positive }));

test("sector weights are smoothed: one positive in 20 barely moves a sector", () => {
  const weights = sectorWeights([...tallies("0", 1000, 20), ...tallies("1", 20, 1)]);
  assert.ok(weights["1"] > 0.9 && weights["1"] < 1.2, String(weights["1"]));
});

test("a sector with many sends at a clearly higher rate moves up", () => {
  const weights = sectorWeights([...tallies("0", 2000, 40), ...tallies("1", 300, 18)]);
  assert.ok(weights["1"] > 1.3, String(weights["1"]));
  assert.ok(weights["1"] <= 1.5);
  assert.ok(weights["0"] >= 0.7);
});

test("no learning until there are 5 positives overall", () => {
  assert.deepEqual(sectorWeights([...tallies("0", 200, 2), ...tallies("1", 200, 2)]), {});
});

const touch = (cardId: string, extra: Partial<OutcomeTouch> = {}): OutcomeTouch => ({ cardId, sector: "3", channel: "email", sentAt: "2026-09-01T12:00:00Z", replyClassification: null, ...extra });

test("list outcomes count one send per card from touches, whatever the card's status", () => {
  const result = listOutcomes([
    touch("a"),
    touch("a", { sentAt: "2026-09-05T12:00:00Z" }),
    touch("b", { cardStatus: "dismissed" }),
    touch("c", { replyClassification: "negative" }),
    touch("d", { qualifiedAt: "2026-09-10T00:00:00Z" }),
    touch("e", { cardStatus: "opportunity" }),
    touch("f", { replyClassification: "ooo" }),
    touch("g", { channel: "linkedin" }),
    touch("h", { replyClassification: "referral", sector: null }),
  ]);
  assert.equal(result.total.sends, 7, "follow-ups add nothing; the LinkedIn-only card is not an email send");
  assert.equal(result.bySector["3"].sends, 6);
  assert.equal(result.bySector["3"].positive, 2, "qualified and opportunity cards count as positive");
  assert.equal(result.bySector["3"].replied, 1, "negative is a reply, ooo is not");
  assert.equal(result.total.positive, 3);
  assert.ok(result.cards.some((card) => card.cardId === "b"), "a dismissed sent card stays in the denominator");
  const weighted = listOutcomes([touch("x", { replyClassification: "neutral" })], { plainReplyWeight: 0.3 });
  assert.equal(weighted.total.positive, 0.3);
});

test("fit outcomes split by band and criterion, and flag small samples", () => {
  const rows = [
    ...Array.from({ length: 12 }, () => ({ fitScore: 54, breakdown: { hiring: 12 }, classification: "neutral" })),
    ...Array.from({ length: 5 }, () => ({ fitScore: 55, breakdown: { systems: 8 }, classification: "positive" })),
    { fitScore: 69, breakdown: null, classification: null },
    { fitScore: 70, breakdown: { hiring: 25 }, classification: "ooo" },
    { fitScore: null, breakdown: null, classification: "positive" },
  ];
  const report = fitOutcomes(rows);
  assert.deepEqual(report.bands.map((band) => band.sends), [12, 6, 1]);
  assert.equal(report.bands[0].tooSmall, false);
  assert.equal(report.bands[1].tooSmall, true);
  assert.equal(report.bands[1].positive, 5);
  assert.equal(report.total.sends, 19);
  for (const split of Object.values(report.criteria)) {
    assert.equal(split.withPoints.sends + split.without.sends, report.total.sends);
    assert.equal(split.withPoints.replies + split.without.replies, report.total.replies);
  }
  assert.equal(report.criteria.hiring.withPoints.sends, 13);
});
