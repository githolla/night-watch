import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as localTime from "./local-time.ts";
import * as rules from "./morning-send-rules.ts";
import * as bulkSendable from "./bulk-sendable.ts";
import { queryDb } from "./testing/query-db.ts";

type Row = Record<string, unknown>;
type SendInput = { cardId: string; owner: string; automatic?: boolean };
type Result = Array<{ owner: string; action: string; sent?: number; held?: number; reason?: string }>;
type Options = {
  now?: Date; postSlackMessage?: (text: string) => Promise<unknown>; sendCardEmail?: (db: unknown, input: SendInput) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>; random?: () => number; clock?: () => number; finalizeOpenLists?: (db: unknown, listDate: string) => Promise<unknown>;
};
type Module = { runMorningSend: (db: unknown, options: Options) => Promise<Result>; addSentCount: (db: unknown, id: string, amount: number) => Promise<void>; autoSendQueue: (db: unknown, owner: string, listDate: string) => Promise<Array<{ cardId: string; held: string | null }>> };

function load(): Module {
  const source = readFileSync(new URL("./morning-send.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mocks: Record<string, unknown> = {
    "./bulk-sendable.ts": bulkSendable,
    "./card-send.ts": { sendCardEmail: async () => { throw new Error("inject sendCardEmail"); } },
    "./local-time.ts": localTime,
    "./morning-send-rules.ts": rules,
    "./nightly-list-builder.ts": { LIST_OWNERS: ["josh", "suuchi"], nightlyListConfig: () => ({ size: 12 }) },
    "./opt-out.ts": { configuredBaseUrl: () => "https://app.test" },
    "./slack.ts": { postSlackMessage: async () => { throw new Error("inject postSlackMessage"); } },
  };
  const exports: Record<string, unknown> = {};
  runInNewContext(output, { exports, Date, Error, console: { warn() {}, error() {} }, process, require: (name: string) => { if (name in mocks) return mocks[name]; throw new Error(`Unmocked ${name}`); } });
  return exports as unknown as Module;
}
const morning = load();

// Thursday 1 October 2026, US Eastern (EDT, UTC-4).
const at = (hhmm: string, date = "2026-10-01") => new Date(`${date}T${hhmm}:00-04:00`);
const TODAY = "2026-10-01";
const profile = (owner: string, extra: Row = {}) => ({ owner, auto_send: true, auto_send_paused: false, postal_address: "1 Main St", ...extra });
const listRow = (domain: string, company: string, extra: Row = {}) => ({ domain, company, emailCheck: { level: "deliverable", reason: "Hunter verified this address." }, ...extra });
const card = (id: string, owner: string, domain: string, company: string, extra: Row = {}) => ({
  id, status: "edited", email_subject: "Idea", email_body: "Hi there?", assigned_to: owner, auto_send_hold: false,
  accounts: { domain, name: company }, signals: { hash: `operator-shortlist-20260923:${domain}` }, people: { email_check: { level: "deliverable" } }, ...extra,
});
const list = (owner: string, extra: Row = {}) => ({ id: `list-${owner}`, list_date: TODAY, owner, status: "ready", rows: [], errors: [], announced_at: null, summary_posted_at: null, sent_count: 0, held_count: 0, ...extra });

function harness(seed: Record<string, Row[]>) {
  const { db, tables } = queryDb(seed, {
    increment_list_sent: (args, all) => {
      const row = all.reachout_lists.find((item) => item.id === args.list_id)!;
      row.sent_count = Number(row.sent_count) + Number(args.amount);
      return row.sent_count;
    },
  });
  const posts: string[] = [];
  const sends: SendInput[] = [];
  const options = (now: Date, extra: Options = {}): Options => ({
    now, sleep: async () => {}, random: () => 0,
    postSlackMessage: async (text) => { posts.push(text); return true; },
    sendCardEmail: async (_db, input) => { sends.push(input); return { ok: true }; },
    ...extra,
  });
  return { db, tables, posts, sends, run: (now: Date, extra: Options = {}) => morning.runMorningSend(db, options(now, extra)) };
}

test("nothing builds, posts or sends on a Saturday", async () => {
  const h = harness({ reachout_lists: [list("josh", { rows: [listRow("acme.test", "Acme")] })], sender_profiles: [profile("josh"), profile("suuchi")], cards: [card("c1", "josh", "acme.test", "Acme")] });
  let finalized = 0;
  for (const time of ["07:00", "09:30", "11:30"]) {
    const result = await h.run(at(time, "2026-10-03"), { finalizeOpenLists: async () => { finalized += 1; } });
    assert.ok(result.every((seat) => seat.action === "not a send day"));
  }
  assert.equal(h.sends.length, 0);
  assert.equal(h.posts.length, 0);
  assert.equal(finalized, 0);
});

test("two runs at 7:00, one after the other or at once, post the announcement once", async () => {
  const h = harness({ reachout_lists: [list("josh", { rows: [listRow("acme.test", "Acme")] }), list("suuchi", { rows: [listRow("beta.test", "Beta")] })], sender_profiles: [profile("josh"), profile("suuchi")], cards: [] });
  await Promise.all([h.run(at("07:00")), h.run(at("07:00"))]);
  await h.run(at("07:10"));
  assert.equal(h.posts.filter((text) => text.includes("Josh")).length, 1);
  assert.equal(h.posts.filter((text) => text.includes("Suuchi")).length, 1);
});

test("a thrown Slack error releases the claim; Slack not being set up does not", async () => {
  const h = harness({ reachout_lists: [list("josh", { rows: [listRow("acme.test", "Acme")] }), list("suuchi")], sender_profiles: [profile("josh"), profile("suuchi")], cards: [] });
  await h.run(at("07:00"), { postSlackMessage: async () => { throw new Error("Slack down"); } });
  assert.equal(h.tables.reachout_lists[0].announced_at, null);
  await h.run(at("07:10"), { postSlackMessage: async () => false });
  assert.ok(h.tables.reachout_lists[0].announced_at);
  await h.run(at("07:20"));
  assert.equal(h.posts.length, 0);
});

test("a list still building at the first run is finalized, then announced", async () => {
  const h = harness({ reachout_lists: [list("josh", { status: "building", rows: [listRow("acme.test", "Acme")] }), list("suuchi", { status: "building" })], sender_profiles: [profile("josh"), profile("suuchi")], cards: [] });
  const finalizeOpenLists = async (_db: unknown, listDate: string) => {
    for (const row of h.tables.reachout_lists) if (row.list_date === listDate && row.status === "building") row.status = (row.rows as Row[]).length ? "ready" : "failed";
  };
  // The in-app build is on, so a failed empty list is news.
  await withAnthropicKey("sk-ant-test", () => h.run(at("07:00"), { finalizeOpenLists }));
  assert.equal(h.tables.reachout_lists[0].status, "ready");
  assert.match(h.posts.find((text) => text.includes("Josh")) ?? "", /expected to auto-send/);
  assert.match(h.posts.find((text) => text.includes("Suuchi")) ?? "", /No list for Suuchi today: the nightly build failed/);
});

test("a failed list gives exactly one alert across five runs", async () => {
  const h = harness({ reachout_lists: [list("josh", { status: "failed", errors: [{ domain: "a.test", reason: "no buyer found" }, { domain: "b.test", reason: "no buyer found" }] }), list("suuchi", { status: "ready", announced_at: at("07:00").toISOString(), summary_posted_at: at("11:30").toISOString() })], sender_profiles: [profile("josh"), profile("suuchi")], cards: [] });
  await withAnthropicKey("sk-ant-test", async () => { for (const time of ["07:00", "07:10", "09:00", "10:00", "11:40"]) await h.run(at(time)); });
  assert.equal(h.posts.length, 1);
  assert.match(h.posts[0], /No list for Josh today: the nightly build failed.*no buyer found \(2\)/);
  assert.equal(h.sends.length, 0);
});

async function withAnthropicKey<T>(value: string | undefined, run: () => Promise<T>) {
  const previous = process.env.ANTHROPIC_API_KEY;
  if (value === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = value;
  try { return await run(); } finally { if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous; }
}

test("a missing list row gives one alert and leaves a failed row behind", async () => {
  const h = harness({ reachout_lists: [list("suuchi", { announced_at: at("07:00").toISOString() })], sender_profiles: [profile("josh"), profile("suuchi")], cards: [] });
  await withAnthropicKey("sk-ant-test", async () => {
    const early = await h.run(at("06:50"));
    assert.equal(early[0].action, "no list");
    for (const time of ["07:00", "07:10", "07:20"]) await h.run(at(time));
  });
  assert.equal(h.posts.length, 1);
  assert.match(h.posts[0], /No list for Josh today: the nightly build never started/);
  assert.equal(h.tables.reachout_lists.find((row) => row.owner === "josh")?.status, "failed");
});

test("with the nightly build switched off (no Anthropic key), a day without a list posts nothing", async () => {
  const h = harness({ reachout_lists: [], sender_profiles: [profile("josh"), profile("suuchi")], cards: [] });
  await withAnthropicKey(undefined, async () => { for (const time of ["07:00", "07:10", "11:40"]) await h.run(at(time)); });
  assert.equal(h.posts.length, 0);
  assert.equal(h.tables.reachout_lists.length, 0);
});

test("with the nightly build switched off, an empty failed list posts nothing either", async () => {
  const h = harness({ reachout_lists: [list("josh", { status: "failed" }), list("suuchi", { status: "failed" })], sender_profiles: [profile("josh"), profile("suuchi")], cards: [] });
  await withAnthropicKey(undefined, async () => { for (const time of ["07:00", "07:10", "11:40"]) await h.run(at(time)); });
  assert.equal(h.posts.length, 0);
});

test("yesterday's bounces pause this morning before anything sends, with names and a Settings link", async () => {
  const h = harness({
    reachout_lists: [list("josh", { rows: [listRow("acme.test", "Acme")], announced_at: at("07:00").toISOString() }), list("suuchi", { announced_at: at("07:00").toISOString() })],
    sender_profiles: [profile("josh"), profile("suuchi", { auto_send: false })],
    cards: [card("c1", "josh", "acme.test", "Acme")],
    touches: [
      { id: "t1", sent_by: "josh", channel: "email", gmail_thread_id: "th1", sent_at: at("10:00", "2026-09-30").toISOString(), bounced_at: at("16:00", "2026-09-30").toISOString(), people: { email: "bad@zeta.test" }, cards: { accounts: { name: "Zeta" } } },
      { id: "t2", sent_by: "josh", channel: "email", gmail_thread_id: "th2", sent_at: at("10:10", "2026-09-30").toISOString(), bounced_at: at("17:00", "2026-09-30").toISOString(), people: { email: "gone@eta.test" }, cards: { accounts: { name: "Eta" } } },
    ],
  });
  const result = await h.run(at("09:00"));
  assert.equal(result[0].action, "paused");
  assert.equal(h.sends.length, 0);
  assert.equal(h.tables.sender_profiles[0].auto_send_paused, true);
  assert.match(String(h.tables.sender_profiles[0].auto_send_paused_reason), /automatic follow-ups are paused/);
  assert.match(h.posts[0], /bad@zeta\.test \(Zeta\)/);
  assert.match(h.posts[0], /https:\/\/app\.test\/settings/);
  assert.doesNotMatch(h.posts[0], /delivery-recovery/);
});

test("bounces from before the last resume do not pause again, and follow-ups on a thread are not first emails", async () => {
  const bounced = (id: string, thread: string, sent: string) => ({ id, sent_by: "josh", channel: "email", gmail_thread_id: thread, sent_at: at(sent, "2026-09-30").toISOString(), bounced_at: at("18:00", "2026-09-30").toISOString() });
  const h = harness({
    reachout_lists: [list("josh", { rows: [listRow("acme.test", "Acme")], announced_at: at("07:00").toISOString() }), list("suuchi", { announced_at: at("07:00").toISOString() })],
    sender_profiles: [profile("josh", { auto_send_resumed_at: at("08:00").toISOString() }), profile("suuchi", { auto_send: false })],
    cards: [card("c1", "josh", "acme.test", "Acme")],
    touches: [bounced("t1", "th1", "10:00"), bounced("t2", "th2", "10:10")],
  });
  assert.equal((await h.run(at("09:30")))[0].action, "sent");
  assert.equal(h.sends.length, 1);
  assert.equal(h.tables.reachout_lists[0].sent_count, 1);

  const followups = harness({
    reachout_lists: [list("josh", { rows: [listRow("acme.test", "Acme")], announced_at: at("07:00").toISOString() }), list("suuchi", { announced_at: at("07:00").toISOString() })],
    sender_profiles: [profile("josh"), profile("suuchi", { auto_send: false })],
    cards: [card("c1", "josh", "acme.test", "Acme")],
    touches: [
      { id: "first", sent_by: "josh", channel: "email", gmail_thread_id: "th1", sent_at: at("10:00", "2026-09-01").toISOString(), bounced_at: null },
      { id: "f1", sent_by: "josh", channel: "email", gmail_thread_id: "th1", sent_at: at("10:00", "2026-09-29").toISOString(), bounced_at: at("18:00", "2026-09-30").toISOString() },
      { id: "f2", sent_by: "josh", channel: "email", gmail_thread_id: "th1", sent_at: at("10:00", "2026-09-30").toISOString(), bounced_at: at("18:00", "2026-09-30").toISOString() },
    ],
  });
  assert.equal((await followups.run(at("09:30")))[0].action, "sent");
});

test("identity holds and kept cards are not sent; the summary names each card left and why", async () => {
  const h = harness({
    reachout_lists: [list("josh", { rows: [listRow("acme.test", "Acme"), listRow("beta.test", "Beta", { identityHold: "the buyer left the company" }), listRow("kept.test", "Kept"), listRow("gamma.test", "Gamma")], announced_at: at("07:00").toISOString() }), list("suuchi", { announced_at: at("07:00").toISOString() })],
    sender_profiles: [profile("josh"), profile("suuchi", { auto_send: false })],
    cards: [
      card("c1", "josh", "acme.test", "Acme"),
      card("c2", "josh", "beta.test", "Beta"),
      card("c3", "josh", "kept.test", "Kept", { auto_send_hold: true }),
      card("c4", "josh", "gamma.test", "Gamma", { people: { email_check: { level: "risky", reason: "Not confirmed by Hunter or by the company's known format." } } }),
    ],
  });
  const sendCardEmail = async (_db: unknown, input: SendInput) => {
    h.sends.push(input);
    if (input.cardId === "c4") throw new Error("Not confirmed. Nothing was sent.");
    h.tables.cards.find((row) => row.id === input.cardId)!.status = "sent";
    return { ok: true };
  };
  await h.run(at("11:20"), { sendCardEmail });
  assert.deepEqual(h.sends.map((input) => input.cardId), ["c1", "c4"]);
  assert.ok(h.sends.every((input) => input.automatic === true));
  assert.equal(h.tables.cards.find((row) => row.id === "c2")?.auto_send_hold_reason, "the buyer left the company");
  await h.run(at("11:30"), { sendCardEmail });
  assert.equal(h.posts.length, 1);
  const summary = h.posts[0];
  assert.match(summary, /1 sent automatically, 1 kept by you to send by hand, 2 left on the list/);
  assert.match(summary, /- Beta: the buyer left the company/);
  assert.match(summary, /- Gamma: Not confirmed by Hunter/);
  assert.doesNotMatch(summary, /Kept:/);
  assert.doesNotMatch(summary, /edited after the hold/);
  assert.equal(h.tables.reachout_lists[0].held_count, 2);
});

test("no send starts once the run is 240 seconds old", async () => {
  const domains = ["a", "b", "c", "d"];
  const h = harness({
    reachout_lists: [list("josh", { rows: domains.slice(0, 2).map((d) => listRow(`${d}.test`, d)), announced_at: at("07:00").toISOString() }), list("suuchi", { rows: domains.slice(2).map((d) => listRow(`${d}.test`, d)), announced_at: at("07:00").toISOString() })],
    sender_profiles: [profile("josh"), profile("suuchi")],
    cards: [card("c1", "josh", "a.test", "A"), card("c2", "josh", "b.test", "B"), card("c3", "suuchi", "c.test", "C"), card("c4", "suuchi", "d.test", "D")],
  });
  let now = 0;
  const starts: number[] = [];
  const result = await h.run(at("11:20"), {
    clock: () => now, random: () => 1,
    sleep: async (ms) => { assert.ok(ms <= 45_000); now += ms; },
    sendCardEmail: async (_db, input) => { starts.push(now); h.sends.push(input); now += 60_000; return { ok: true }; },
  });
  assert.equal(starts.length, 2);
  assert.ok(starts.every((start) => start < 240_000), starts.join(","));
  assert.match(String(result[1].reason), /time budget/);
});

test("pacing sends at most two a run", async () => {
  const h = harness({
    reachout_lists: [list("josh", { rows: ["a", "b", "c", "d"].map((d) => listRow(`${d}.test`, d)), announced_at: at("07:00").toISOString() }), list("suuchi", { announced_at: at("07:00").toISOString() })],
    sender_profiles: [profile("josh"), profile("suuchi", { auto_send: false })],
    cards: ["a", "b", "c", "d"].map((d, index) => card(`c${index}`, "josh", `${d}.test`, d)),
  });
  await h.run(at("11:20"));
  assert.equal(h.sends.length, 2);
});

test("a one-day skip stops today's sends", async () => {
  const h = harness({
    reachout_lists: [list("josh", { rows: [listRow("acme.test", "Acme")], announced_at: at("07:00").toISOString() }), list("suuchi", { announced_at: at("07:00").toISOString() })],
    sender_profiles: [profile("josh", { auto_send_skip_on: TODAY }), profile("suuchi", { auto_send: false })],
    cards: [card("c1", "josh", "acme.test", "Acme")],
  });
  const result = await h.run(at("09:30"));
  assert.equal(result[0].reason, "auto-send is skipped for today");
  assert.equal(h.sends.length, 0);
});

test("concurrent sent-count increments of 1 and 2 add up to 3", async () => {
  const h = harness({ reachout_lists: [list("josh")] });
  await Promise.all([morning.addSentCount(h.db, "list-josh", 1), morning.addSentCount(h.db, "list-josh", 2)]);
  assert.equal(h.tables.reachout_lists[0].sent_count, 3);
});

test("with no list today, leftover drafts with a usable address send in the window; held and paused ones do not", async () => {
  const leftover = (id: string, domain: string, people: Row, extra: Row = {}) => card(id, "suuchi", domain, domain, { accounts: { domain, name: domain, status: "active" }, people, ...extra });
  const h = harness({
    reachout_lists: [],
    sender_profiles: [profile("josh", { auto_send: false }), profile("suuchi")],
    cards: [
      leftover("verified", "v.test", { email: "a@v.test", email_status: "verified" }),
      leftover("likely", "l.test", { email: "b@l.test", email_status: "unverified", email_check: { email: "b@l.test", likely: true } }),
      leftover("guess", "g.test", { email: "c@g.test", email_status: "unverified", email_check: { level: "risky" } }),
      leftover("held", "h.test", { email: "d@h.test", email_status: "verified" }, { auto_send_hold_reason: "Bounced before." }),
      leftover("paused", "p.test", { email: "e@p.test", email_status: "verified" }, { accounts: { domain: "p.test", name: "P", status: "paused" } }),
    ],
  });
  assert.equal(h.sends.length, 0);
  await h.run(at("08:30"));
  assert.equal(h.sends.length, 0, "nothing before the window");
  const sendCardEmail = async (_db: unknown, input: SendInput) => { h.sends.push(input); h.tables.cards.find((row) => row.id === input.cardId)!.status = "sent"; return { ok: true }; };
  const result = await h.run(at("11:20"), { sendCardEmail });
  assert.equal(h.sends.length, 2, "two a run");
  await h.run(at("11:25"), { sendCardEmail });
  assert.deepEqual(h.sends.map((input) => input.cardId).sort(), ["guess", "likely", "verified"], "the unconfirmed guess goes too");
  assert.ok(h.sends.every((input) => input.automatic === true && input.owner === "suuchi"));
  assert.equal(result[1].action, "sent");
  assert.equal(result[0].action, "no list");
  assert.equal(h.posts.length, 0);
});

test("the daily cap stops the run without holding the card", async () => {
  const h = harness({
    reachout_lists: [],
    sender_profiles: [profile("josh", { auto_send: false }), profile("suuchi")],
    cards: [card("c1", "suuchi", "a.test", "A", { accounts: { domain: "a.test", name: "A", status: "active" }, people: { email: "a@a.test", email_status: "verified" } })],
  });
  const result = await h.run(at("11:20"), { sendCardEmail: async () => { throw new Error("Daily sender cap of 25 reached"); } });
  assert.match(String(result[1].reason), /daily sending cap/);
  assert.equal(h.tables.cards[0].auto_send_hold_reason, undefined);
});

test("the queue the Drafts page shows is the order the morning run sends in", async () => {
  const leftover = (id: string, domain: string, created: string) => card(id, "suuchi", domain, domain, { created_at: created, accounts: { domain, name: domain, status: "active" }, people: { email: `x@${domain}`, email_status: "verified" } });
  const h = harness({
    reachout_lists: [list("josh", { announced_at: at("07:00").toISOString() }), list("suuchi", { rows: [listRow("t1.test", "T1"), listRow("t2.test", "T2", { identityHold: "the buyer left" })], announced_at: at("07:00").toISOString() })],
    sender_profiles: [profile("josh", { auto_send: false }), profile("suuchi")],
    cards: [
      card("t1", "suuchi", "t1.test", "T1"), card("t2", "suuchi", "t2.test", "T2"),
      leftover("old", "old.test", "2026-09-01T00:00:00Z"), leftover("newer", "newer.test", "2026-09-20T00:00:00Z"), leftover("mid", "mid.test", "2026-09-10T00:00:00Z"),
    ],
  });
  const queue = await morning.autoSendQueue(h.db, "suuchi", TODAY);
  assert.deepEqual(JSON.parse(JSON.stringify(queue)), [{ cardId: "t1", held: null }, { cardId: "t2", held: "the buyer left" }, { cardId: "old", held: null }, { cardId: "mid", held: null }, { cardId: "newer", held: null }]);
  const sendCardEmail = async (_db: unknown, input: SendInput) => { h.sends.push(input); h.tables.cards.find((row) => row.id === input.cardId)!.status = "sent"; return { ok: true }; };
  for (const time of ["09:00", "09:10", "09:20", "09:30", "09:40"]) await h.run(at(time), { sendCardEmail });
  assert.deepEqual(JSON.parse(JSON.stringify(h.sends.map((input) => input.cardId))), JSON.parse(JSON.stringify(queue.filter((entry) => !entry.held).map((entry) => entry.cardId))));
});
