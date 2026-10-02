import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as aiFit from "./ai-fit.ts";
import * as anthropicCost from "./anthropic-cost.ts";
import * as listSectors from "./list-sectors.ts";
import * as localTime from "./local-time.ts";
import * as morningRules from "./morning-send-rules.ts";
import * as rules from "./nightly-list-rules.ts";
import { isExcludedSector } from "./nightly-research.ts";
import { queryDb } from "./testing/query-db.ts";

const require = createRequire(import.meta.url);

type Row = Record<string, unknown>;
type Result = { listDate: string; lists: Array<{ owner: string; status: string; rows: number; deliverable: number; attempts: number; costUsd: number }>; sourced: number; sourcing: Array<{ parsed: number; kept: number }>; reservesUsed: number; stopped: string };
type Options = { now?: Date; clock?: () => number; timeBudgetMs?: number; abortAtMs?: number; abortGraceMs?: number };
type ResearchCall = { candidate: Row; owner: string; overrides: { signal?: AbortSignal } };
type Hooks = {
  research: (call: ResearchCall) => Promise<Row>;
  source: (prompt: string, options: Row, recorder?: (cost: number) => void) => Promise<unknown>;
  prepare: (domain: string) => Promise<Response>;
  verifySite: (domain: string) => Promise<Row>;
};
type Module = {
  runNightlyListBuild: (db: unknown, options?: Options) => Promise<Result>;
  finalizeOpenLists: (db: unknown, listDate: string) => Promise<Array<{ owner: string; closed: boolean }>>;
  preparePendingRows: (db: unknown, listDate: string) => Promise<number>;
  claimBuildAlert: (db: unknown, now?: Date) => Promise<boolean>;
  learnedSectorWeights: (db: unknown) => Promise<Record<string, number>>;
  nightlyListConfig: () => { budgetUsd: number; maxCostPerCompanyUsd: number; research: number; size: number };
};

const calls = { research: [] as ResearchCall[], source: [] as string[], prepare: [] as string[] };
const defaults: Hooks = {
  research: async () => ({ skip: "AI fit 10 is below 40", cost: 0.1, searches: 1 }),
  source: async () => ({ companies: [] }),
  prepare: async () => Response.json({ id: "card" }),
  verifySite: async (domain) => ({ action: "keep", domain, confirmed: true }),
};
const hooks: Hooks = { ...defaults };

function load(): Module {
  const source = readFileSync(new URL("./nightly-list-builder.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mocks: Record<string, unknown> = {
    zod: require("zod"),
    "./ai-fit.ts": aiFit,
    "./anthropic-cost.ts": anthropicCost,
    "./agents.ts": { runSearchAgent: (prompt: string, options: Row, recorder?: (cost: number) => void) => { calls.source.push(prompt); return hooks.source(prompt, options, recorder); } },
    "./focus-data.ts": { allFocus: () => [] },
    "./local-time.ts": localTime,
    "./list-sectors.ts": listSectors,
    "./models.ts": { researchModel: () => "test-model" },
    "./morning-send-rules.ts": morningRules,
    "./nightly-list-rules.ts": rules,
    "./nightly-lists.ts": { loadNightlyLists: async () => {} },
    "./nightly-research.ts": { isExcludedSector, researchOne: (candidate: Row, owner: string, _date: string, overrides: ResearchCall["overrides"]) => { const call = { candidate, owner, overrides }; calls.research.push(call); return hooks.research(call); } },
    "./prepare-priority-draft.ts": { preparePriorityDraft: (domain: string) => { calls.prepare.push(domain); return hooks.prepare(domain); } },
    "./recipient-verification.ts": { domainAcceptsMail: async () => true, recordRecipientCheck: async () => {} },
    "./site-check.ts": { verifySite: (domain: string) => hooks.verifySite(domain) },
  };
  const exports: Record<string, unknown> = {};
  runInNewContext(output, {
    exports, Date, Error, Response, URL, AbortController, AbortSignal, setTimeout, clearTimeout, process, fetch: async () => new Response(""),
    console: { info() {}, warn() {}, error() {} },
    require: (name: string) => { if (name in mocks) return mocks[name]; throw new Error(`Unmocked ${name}`); },
  });
  return exports as unknown as Module;
}
const builder = load();

// Thursday 1 October 2026, 03:00 US Eastern (EDT, UTC-4).
const NOW = new Date("2026-10-01T07:00:00Z");
const TODAY = "2026-10-01";
const list = (owner: string, extra: Row = {}) => ({ id: `list-${owner}`, list_date: TODAY, owner, status: "building", rows: [], offers: [], attempts: 0, cost_usd: 0, errors: [], ...extra });
const lists = (extra: Row = {}) => [list("josh", extra), list("suuchi", extra)];
const candidate = (domain: string, extra: Row = {}) => ({ id: `c-${domain}`, company: domain.split(".")[0], domain, sector: "landscape", revenue_usd_m: 40, revenue_year: 2025, source_url: "https://rank.test/list", sector_key: 2, status: "new", prior_score: 50, research_attempts: 0, retry_count: 0, cost_usd: 0, ...extra });
const listRow = (domain: string, fit: number, extra: Row = {}) => ({ domain, company: domain, buyer: { name: "Pat Lee" }, contacts: [], aiFit: { score: fit }, emailCheck: { level: "deliverable", email: `pat@${domain}` }, identityHold: null, ...extra });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function reset(overrides: Partial<Hooks> = {}) {
  Object.assign(hooks, defaults, overrides);
  calls.research.length = 0; calls.source.length = 0; calls.prepare.length = 0;
}

test("the defaults are unchanged: a $10 night and $0.50 a company", () => {
  const config = builder.nightlyListConfig();
  assert.equal(config.budgetUsd, 10);
  assert.equal(config.maxCostPerCompanyUsd, 0.5);
});

test("nothing is built for a Saturday: no list rows and no agent calls", async () => {
  reset();
  const { db, tables } = queryDb({ list_candidates: [candidate("acme.test")] });
  const result = await builder.runNightlyListBuild(db, { now: new Date("2026-10-03T07:00:00Z") });
  assert.equal(result.stopped, "not_a_send_day");
  assert.equal((tables.reachout_lists ?? []).length, 0);
  assert.equal(calls.research.length + calls.source.length, 0);
});

test("with 60 cents of budget left at a 50 cent cap, at most one company is launched", async () => {
  reset({ research: async () => ({ skip: "AI fit 10 is below 40", cost: 0.5, searches: 3 }) });
  const { db } = queryDb({ reachout_lists: [list("josh", { cost_usd: 9.4 }), list("suuchi")], list_candidates: ["a.test", "b.test", "c.test", "d.test"].map((domain) => candidate(domain)) });
  const result = await builder.runNightlyListBuild(db, { now: NOW });
  assert.equal(calls.research.length, 1);
  assert.equal(result.stopped, "cost_budget");
});

test("companies still being researched count against the budget at the cap", async () => {
  reset();
  const fresh = new Date(NOW.getTime() - 60_000).toISOString();
  const researching = ["r1.test", "r2.test", "r3.test"].map((domain) => candidate(domain, { status: "researching", list_date: TODAY, owner: "josh", updated_at: fresh }));
  const { db, tables } = queryDb({ reachout_lists: [list("josh", { cost_usd: 8.5 }), list("suuchi")], list_candidates: [...researching, candidate("a.test")] });
  const result = await builder.runNightlyListBuild(db, { now: NOW });
  assert.equal(result.stopped, "cost_budget");
  assert.equal(calls.research.length, 0);
  assert.equal(tables.reachout_lists[0].status, "building", "lists stay open while research is still in flight");
});

test("a stale claim cut off twice is skipped, a first one goes back in the queue, and both are charged", async () => {
  reset({ research: async () => { throw new Error("no research in this test"); } });
  const stale = new Date(NOW.getTime() - 20 * 60_000).toISOString();
  const { db, tables } = queryDb({
    reachout_lists: lists({ attempts: 20 }),
    list_candidates: [
      candidate("twice.test", { status: "researching", research_attempts: 2, list_date: TODAY, owner: "josh", updated_at: stale }),
      candidate("once.test", { status: "researching", research_attempts: 1, list_date: TODAY, owner: "josh", updated_at: stale }),
    ],
  });
  await builder.runNightlyListBuild(db, { now: NOW });
  const twice = tables.list_candidates.find((row) => row.domain === "twice.test")!;
  const once = tables.list_candidates.find((row) => row.domain === "once.test")!;
  assert.equal(twice.status, "skipped");
  assert.equal(twice.skip_reason, "timed out twice");
  assert.equal(once.status, "new");
  assert.equal(tables.reachout_lists[0].cost_usd, 1, "two unrecorded claims charged at the 50 cent cap");
});

test("no research batch or sourcing call starts after the cutoff", async () => {
  reset();
  let tick = 0;
  const { db } = queryDb({ reachout_lists: lists() });
  const result = await builder.runNightlyListBuild(db, { now: NOW, clock: () => (tick++ === 0 ? 0 : 200_000) });
  assert.equal(result.stopped, "time_budget");
  assert.equal(calls.source.length + calls.research.length, 0);
});

test("a task that hangs past the deadline loses nothing: the others are saved and it goes back in the queue", async () => {
  let savedAtAbort: Row[] = [];
  let tablesRef: Record<string, Row[]> = {};
  reset({
    research: (call) => {
      if (call.candidate.domain === "hang.test") {
        call.overrides.signal?.addEventListener("abort", () => { savedAtAbort = json(tablesRef.list_candidates); });
        return new Promise<Row>(() => {});
      }
      return Promise.resolve({ skip: "AI fit 20 is below 40", cost: 0.2, searches: 2, fit: { score: 20 } });
    },
  });
  const { db, tables } = queryDb({ reachout_lists: lists(), list_candidates: [candidate("hang.test", { prior_score: 90 }), candidate("a.test", { prior_score: 80 }), candidate("b.test", { prior_score: 70 })] });
  tablesRef = tables;
  const result = await builder.runNightlyListBuild(db, { now: NOW, clock: () => 0, abortAtMs: 30, abortGraceMs: 0 });
  assert.equal(result.stopped, "time_budget");
  assert.deepEqual(savedAtAbort.filter((row) => row.status === "skipped").map((row) => row.domain).sort(), ["a.test", "b.test"], "the finished tasks were saved before the abort");
  const hung = tables.list_candidates.find((row) => row.domain === "hang.test")!;
  assert.equal(hung.status, "new");
  assert.equal(hung.owner, null);
  assert.equal(hung.research_attempts, 1);
  const attempts = tables.reachout_lists.reduce((sum, row) => sum + Number(row.attempts), 0);
  const cost = tables.reachout_lists.reduce((sum, row) => sum + Number(row.cost_usd), 0);
  assert.equal(attempts, 2, "the hung company used none of the lists' evaluations");
  assert.ok(Math.abs(cost - 0.4) < 1e-9);
});

test("a failed sourcing call leaves the lists open, and the third one closes them", async () => {
  reset({ source: async () => { throw new Error("overloaded"); } });
  const { db, tables } = queryDb({ reachout_lists: lists() });
  const first = await builder.runNightlyListBuild(db, { now: NOW });
  assert.equal(first.stopped, "sourcing_retry");
  assert.equal(tables.reachout_lists[0].status, "building");
  assert.deepEqual(json(tables.reachout_lists[0].errors), [{ kind: "sourcing", reason: "sourcing: overloaded" }]);
  assert.equal(tables.reachout_lists[0].cost_usd, 0, "the sourcing cap is replaced by the real cost");
  assert.equal((await builder.runNightlyListBuild(db, { now: NOW })).stopped, "sourcing_retry");
  const third = await builder.runNightlyListBuild(db, { now: NOW });
  assert.equal(third.stopped, "no_candidates");
  assert.equal(tables.reachout_lists[0].status, "failed");
  assert.equal(calls.source.length, 3);
});

test("sourcing filters by sector only, needs a ranking URL, and excludes do-not-contact names", async () => {
  const day = Math.floor(Date.parse(`${TODAY}T00:00:00Z`) / 86_400_000);
  const chosen = listSectors.sectorsForNight(day, {});
  const other = [...listSectors.SECTORS.keys()].find((index) => !chosen.includes(index))!;
  let sourcingCalls = 0;
  reset({
    source: async (_prompt, _options, recorder) => {
      recorder?.(0.3);
      if (sourcingCalls++) return { companies: [] };
      return {
        companies: [
          { company: "Capital Electric", domain: "capitalelectric.test", sector: "electrical contractor", sectorNumber: chosen[0], revenueUsdM: 40, revenueYear: 2025, sourceUrl: "https://rank.test/top100" },
          { company: "No Link Co", domain: "nolink.test", sector: "roofing", sectorNumber: chosen[0], revenueUsdM: 40, revenueYear: 2025, sourceUrl: "the ranking" },
          { company: "Odd Sector Co", domain: "oddsector.test", sector: "plumbing", sectorNumber: 42, revenueUsdM: null, revenueYear: null, sourceUrl: "https://rank.test/top100" },
          { company: "acme landscaping", domain: "acme-new.test", sector: "landscaping", sectorNumber: chosen[1], revenueUsdM: 30, revenueYear: 2025, sourceUrl: "https://rank.test/top100" },
          { company: "Bright IT", domain: "brightit.test", sector: "IT managed services", sectorNumber: chosen[0], revenueUsdM: 30, revenueYear: 2025, sourceUrl: "https://rank.test/top100" },
        ],
      };
    },
  });
  const { db, tables } = queryDb({
    reachout_lists: lists(),
    accounts: [{ id: "acc1", name: "Acme Landscaping, LLC", domain: "acme-old.test", status: "do_not_contact" }],
    list_candidates: [
      candidate("prior-in.test", { status: "skipped", sector_key: chosen[0], source_url: "https://www.lm150.test/list" }),
      candidate("prior-out.test", { status: "skipped", sector_key: other }),
    ],
  });
  const result = await builder.runNightlyListBuild(db, { now: NOW });
  assert.match(calls.source[0], /prior-in\.test/);
  assert.doesNotMatch(calls.source[0], /prior-out\.test/);
  assert.match(calls.source[0], /Rankings already used: lm150\.test/);
  const saved = tables.list_candidates.filter((row) => !String(row.domain).startsWith("prior-"));
  assert.deepEqual(saved.map((row) => row.domain).sort(), ["capitalelectric.test", "oddsector.test"]);
  assert.equal(saved.find((row) => row.domain === "oddsector.test")!.sector_key, null);
  assert.equal(saved.find((row) => row.domain === "oddsector.test")!.revenue_usd_m, null);
  assert.deepEqual(json(result.sourcing[0]), { parsed: 5, kept: 2 });
  assert.equal(result.stopped, "sourcing_retry", "the second, empty call leaves the lists open");
});

test("a sourced company whose homepage is unconfirmed is kept lower in the queue, a dropped one is not saved", async () => {
  reset({
    source: async () => ({ companies: [
      { company: "Up Co", domain: "up.test", sector: "roofing", sectorNumber: 0, revenueUsdM: 40, revenueYear: 2025, sourceUrl: "https://rank.test/a" },
      { company: "Slow Co", domain: "slow.test", sector: "roofing", sectorNumber: 0, revenueUsdM: 40, revenueYear: 2025, sourceUrl: "https://rank.test/a" },
      { company: "Gone Co", domain: "gone.test", sector: "roofing", sectorNumber: 0, revenueUsdM: 40, revenueYear: 2025, sourceUrl: "https://rank.test/a" },
      { company: "Moved Co", domain: "moved-old.test", sector: "roofing", sectorNumber: 0, revenueUsdM: 40, revenueYear: 2025, sourceUrl: "https://rank.test/a" },
    ] }),
    verifySite: async (domain) => domain === "slow.test" ? { action: "unconfirmed", domain, reason: "timed out" } : domain === "gone.test" ? { action: "drop", reason: "does not resolve" } : domain === "moved-old.test" ? { action: "keep", domain: "moved-new.test", confirmed: true } : { action: "keep", domain, confirmed: true },
  });
  const { db, tables } = queryDb({ reachout_lists: lists() });
  await builder.runNightlyListBuild(db, { now: NOW });
  const byDomain = new Map(tables.list_candidates.map((row) => [row.domain, row]));
  assert.ok(byDomain.has("up.test") && byDomain.has("slow.test") && byDomain.has("moved-new.test"));
  assert.ok(!byDomain.has("gone.test") && !byDomain.has("moved-old.test"));
  assert.equal(Number(byDomain.get("up.test")!.prior_score) - Number(byDomain.get("slow.test")!.prior_score), rules.UNCONFIRMED_PRIOR_PENALTY);
});

test("a list still building after the deadline is finalized with its rows", async () => {
  reset();
  const { db, tables } = queryDb({ reachout_lists: [list("josh", { rows: [listRow("a.test", 70), listRow("b.test", 50)], attempts: 5 }), list("suuchi")], sender_profiles: [] });
  const result = await builder.runNightlyListBuild(db, { now: new Date("2026-10-01T09:45:00Z") });
  assert.equal(result.stopped, "deadline");
  assert.equal(tables.reachout_lists[0].status, "ready");
  assert.deepEqual((tables.reachout_lists[0].rows as Row[]).map((row) => row.domain), ["a.test", "b.test"]);
  assert.equal(tables.reachout_lists[1].status, "failed");
  assert.deepEqual(calls.prepare, ["a.test", "b.test"]);
  assert.ok(tables.reachout_lists[0].prepared_at);
});

test("two concurrent finalize calls give exactly one closed list per seat", async () => {
  reset();
  const { db } = queryDb({ reachout_lists: [list("josh", { rows: [listRow("a.test", 70)] })], sender_profiles: [] });
  const [first, second] = await Promise.all([builder.finalizeOpenLists(db, TODAY), builder.finalizeOpenLists(db, TODAY)]);
  const closed = [...first, ...second].filter((item) => item.closed).length;
  assert.equal(closed, 1);
  assert.deepEqual(calls.prepare, ["a.test"], "only the run that closed the list prepares it");
});

test("a do-not-contact account's 409 lands in errors and is not retried", async () => {
  reset({ prepare: async (domain) => domain === "dnc.test" ? Response.json({ error: "This account is paused, a client or marked do not contact. Its existing restriction was preserved." }, { status: 409 }) : Response.json({ id: "card" }) });
  const { db, tables } = queryDb({ reachout_lists: [list("josh", { rows: [listRow("a.test", 70), listRow("dnc.test", 60)] })], sender_profiles: [] });
  await builder.finalizeOpenLists(db, TODAY);
  const errors = json(tables.reachout_lists[0].errors) as Row[];
  assert.deepEqual(errors.map((item) => [item.domain, item.stage, item.status]), [["dnc.test", "prepare", 409]]);
  assert.match(String(errors[0].reason), /do not contact/);
  tables.reachout_lists[0].prepared_at = null;
  await builder.preparePendingRows(db, TODAY);
  assert.equal(calls.prepare.filter((domain) => domain === "dnc.test").length, 1);
});

test("a kept row with no card is prepared by preparePendingRows; one with a card is not", async () => {
  reset({ prepare: async () => { throw new Error("database blip"); } });
  const { db, tables } = queryDb({ reachout_lists: [list("josh", { rows: [listRow("a.test", 70), listRow("b.test", 60)] })], sender_profiles: [], cards: [] });
  await builder.finalizeOpenLists(db, TODAY);
  assert.equal(tables.reachout_lists[0].prepared_at, undefined, "a thrown preparation leaves the list pending");
  tables.cards.push({ id: "card-a", accounts: { domain: "a.test" } });
  reset();
  assert.equal(await builder.preparePendingRows(db, TODAY), 1);
  assert.deepEqual(calls.prepare, ["b.test"]);
  assert.ok(tables.reachout_lists[0].prepared_at);
});

test("while auto-send is live, a deliverable row near the cut beats a risky one", async () => {
  reset();
  const rows = [listRow("risky.test", 70, { emailCheck: { level: "risky" } }), listRow("good.test", 65)];
  const { db, tables } = queryDb({ reachout_lists: [list("josh", { rows })], sender_profiles: [{ owner: "josh", auto_send: true, auto_send_paused: false, postal_address: "1 Main St" }] });
  await builder.finalizeOpenLists(db, TODAY);
  assert.deepEqual((tables.reachout_lists[0].rows as Row[]).map((row) => row.domain), ["good.test", "risky.test"]);
});

test("a requeued company goes back to new once and never twice", async () => {
  reset({ research: async () => ({ skip: "research failed: 529 overloaded", cost: 0.05, searches: 0 }) });
  const old = new Date(NOW.getTime() - 40 * 86_400_000).toISOString();
  const { db, tables } = queryDb({ reachout_lists: lists(), list_candidates: [candidate("retry.test", { status: "skipped", skip_reason: "research failed: 529 overloaded", researched_at: old, prior_score: 50 }), candidate("rejected.test", { status: "skipped", skip_reason: "rejected: consulting", researched_at: old })] });
  await builder.runNightlyListBuild(db, { now: NOW });
  const row = tables.list_candidates.find((item) => item.domain === "retry.test")!;
  assert.equal(row.retry_count, 1);
  assert.equal(row.prior_score, 50 - rules.REQUEUE_PRIOR_PENALTY);
  assert.equal(calls.research.filter((call) => call.candidate.domain === "retry.test").length, 1);
  row.researched_at = old;
  await builder.runNightlyListBuild(db, { now: NOW });
  assert.equal(calls.research.filter((call) => call.candidate.domain === "retry.test").length, 1, "never requeued a second time");
  assert.equal(tables.list_candidates.find((item) => item.domain === "rejected.test")!.status, "skipped");
});

test("a company later marked do not contact under another domain is not researched", async () => {
  reset();
  const { db, tables } = queryDb({ reachout_lists: lists(), accounts: [{ id: "acc", name: "Acme Landscaping, LLC", domain: "acme-old.test", status: "do_not_contact" }], list_candidates: [candidate("acme-new.test", { company: "acme landscaping" })] });
  await builder.runNightlyListBuild(db, { now: NOW });
  assert.equal(calls.research.length, 0);
  assert.match(String(tables.list_candidates[0].skip_reason), /do-not-contact/);
});

test("a reserve whose account became do not contact is skipped, not listed", async () => {
  reset();
  const recent = new Date(NOW.getTime() - 86_400_000).toISOString();
  const reserve = (domain: string, company: string, fit: number) => candidate(domain, { company, status: "reserve", fit_score: fit, researched_at: recent, prepared: { row: listRow(domain, fit, { company }), offer: { domain } } });
  const { db, tables } = queryDb({ reachout_lists: lists(), accounts: [{ id: "acc", name: "Blocked Co", domain: "blocked-old.test", status: "client" }], list_candidates: [reserve("blocked.test", "Blocked Co", 90), reserve("ok.test", "Ok Co", 80)] });
  await builder.runNightlyListBuild(db, { now: NOW });
  const listed = tables.reachout_lists.flatMap((item) => (item.rows as Row[]).map((row) => row.domain));
  assert.ok(!listed.includes("blocked.test"));
  assert.ok(listed.includes("ok.test"));
  assert.match(String(tables.list_candidates.find((item) => item.domain === "blocked.test")!.skip_reason), /do-not-contact/);
});

test("learned sector weights count qualified cards as positive and keep dismissed sent cards as sends", async () => {
  const listed = (domain: string, sector: number) => ({ id: `l-${domain}`, domain, sector_key: sector, status: "listed" });
  const cards: Row[] = [], touches: Row[] = [], candidates: Row[] = [];
  for (let index = 0; index < 5; index++) {
    candidates.push(listed(`q${index}.test`, 3));
    cards.push({ id: `cq${index}`, status: index % 2 ? "qualified" : "opportunity", accounts: { domain: `q${index}.test` } });
    touches.push({ card_id: `cq${index}`, channel: "email", sent_at: "2026-09-01T10:00:00Z", reply_classification: "none" });
  }
  for (let index = 0; index < 20; index++) {
    candidates.push(listed(`d${index}.test`, 4));
    cards.push({ id: `cd${index}`, status: "dismissed", accounts: { domain: `d${index}.test` } });
    touches.push({ card_id: `cd${index}`, channel: "email", sent_at: "2026-09-01T10:00:00Z", reply_classification: "none" });
  }
  const { db } = queryDb({ list_candidates: candidates, cards, touches });
  const weights = await builder.learnedSectorWeights(db);
  assert.ok(weights["3"] > 1, `qualified sector weight ${weights["3"]}`);
  assert.ok(weights["4"] < 1, `dismissed sector weight ${weights["4"]}`);
});

test("two failing invocations claim one alert", async () => {
  const { db } = queryDb({});
  const results = [await builder.claimBuildAlert(db, NOW), await builder.claimBuildAlert(db, NOW)];
  assert.deepEqual(results, [true, false]);
  assert.equal(await builder.claimBuildAlert(db, new Date("2026-10-03T07:00:00Z")), false, "no alert on a day nothing builds");
});
