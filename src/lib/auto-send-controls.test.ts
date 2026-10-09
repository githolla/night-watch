import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as report from "./list-build-report.ts";
import * as morningRules from "./morning-send-rules.ts";

const require = createRequire(import.meta.url);
type Handler = (request: Request, context?: unknown) => Promise<Response>;
function load(path: string, mocks: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, Handler> = {};
  runInNewContext(code, { exports, Error, Response, URL, Date, Math, Number, Promise, process: { env: {} }, require: (key: string) => (key in mocks ? mocks[key] : key === "zod" ? require("zod") : (() => { throw new Error(`Unmocked dependency ${key}`); })()) });
  return exports;
}

type Row = Record<string, unknown>;
/** A tiny query builder: filters by eq, answers maybeSingle with the first match and awaits with every match. */
function fakeDb(tables: Record<string, Row[]>, writes: Array<{ table: string; kind: string; value: Row }>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rows = () => (tables[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        not: () => query,
        gte: () => query,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows(), error: null })),
        upsert: async (value: Row) => {
          writes.push({ table, kind: "upsert", value });
          const existing = (tables[table] ??= []).find((row) => row.owner === value.owner);
          if (existing) Object.assign(existing, value); else tables[table].push({ ...value });
          return { error: null };
        },
      };
      return query;
    },
  };
}

const TODAY = "2026-10-01";
function settingsRoute(user: Row, tables: Record<string, Row[]>, writes: Array<{ table: string; kind: string; value: Row }>) {
  return load("../app/api/settings/auto-send/route.ts", {
    "@/lib/auth": { requireUser: async () => user },
    "@/lib/list-build-report": report,
    "@/lib/local-time": { localParts: () => ({ date: TODAY, weekday: "Thu", hour: 8, minute: 0, minutes: 480 }) },
    "@/lib/nightly-list-builder": { nightlyListConfig: () => ({ research: 20, budgetUsd: 10 }) },
    "@/lib/morning-send-rules": morningRules,
    "@/lib/send-guards": { dailyCap: (days: number) => Math.min(40, 5 + 5 * days), sendDayStart: () => new Date(`${TODAY}T04:00:00Z`) },
    "@/lib/send-plan-loader": { loadSendPlan: async () => ({ going: 4, dayLabel: "today", windowLabel: "9:00am to 11:30am" }) },
    "@/lib/supabase/admin": { admin: () => fakeDb(tables, writes) },
  });
}
const profile = (owner: string, extra: Row = {}) => ({ owner, auto_send: true, auto_send_paused: false, auto_send_paused_reason: null, postal_address: "1 Main St", auto_send_skip_on: null, auto_send_resumed_at: null, ...extra });
const post = (route: Record<string, Handler>, body: Row) => route.POST(new Request("https://test/api/settings/auto-send", { method: "POST", body: JSON.stringify(body) }));

test("resuming auto-send records when it was resumed; pausing does not", async () => {
  const tables = { sender_profiles: [profile("suuchi", { auto_send_paused: true, auto_send_paused_reason: "bounces" })] };
  const writes: Array<{ table: string; kind: string; value: Row }> = [];
  const route = settingsRoute({ owner: "suuchi", role: "member", name: "Suuchi" }, tables, writes);
  const before = Date.now();
  const response = await post(route, { paused: false });
  assert.equal(response.status, 200);
  const resumedAt = Date.parse(String(writes[0].value.auto_send_resumed_at));
  assert.ok(resumedAt >= before && resumedAt <= Date.now());
  assert.equal(writes[0].value.auto_send_paused_reason, null);
  await post(route, { paused: true });
  assert.ok(!("auto_send_resumed_at" in writes[1].value));
});

test("skip today sets today's local date and undo clears it", async () => {
  const tables = { sender_profiles: [profile("josh")] };
  const writes: Array<{ table: string; kind: string; value: Row }> = [];
  const route = settingsRoute({ owner: "josh", role: "member", name: "Josh" }, tables, writes);
  const response = await post(route, { skipToday: true });
  assert.equal(response.status, 200);
  assert.equal(writes[0].value.auto_send_skip_on, TODAY);
  assert.equal((await response.json()).seat.skippedToday, true);
  await post(route, { skipToday: false });
  assert.equal(writes[1].value.auto_send_skip_on, null);
});

test("a member cannot change another seat", async () => {
  const tables = { sender_profiles: [profile("josh"), profile("suuchi")] };
  const writes: Array<{ table: string; kind: string; value: Row }> = [];
  const route = settingsRoute({ owner: "suuchi", role: "member", name: "Suuchi" }, tables, writes);
  for (const body of [{ owner: "josh", skipToday: true }, { owner: "josh", paused: true }]) {
    const response = await post(route, body);
    assert.equal(response.status, 403);
  }
  assert.equal(writes.length, 0);
});

test("skip today asks for migration 0030 before the column exists", async () => {
  const old = { owner: "josh", auto_send: true, auto_send_paused: false, postal_address: "1 Main St" };
  const writes: Array<{ table: string; kind: string; value: Row }> = [];
  const route = settingsRoute({ owner: "josh", role: "admin", name: "Josh" }, { sender_profiles: [old] }, writes);
  const response = await post(route, { skipToday: true });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /0030/);
  assert.equal(writes.length, 0);
});

test("settings return the build report per seat and the shared night spend once", async () => {
  const tables = {
    sender_profiles: [profile("suuchi")],
    gmail_connections: [{ owner: "suuchi", connected_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), created_at: null }],
    reachout_lists: [
      { owner: "josh", list_date: TODAY, status: "ready", rows: [], attempts: 20, sent_count: 0, held_count: 0, announced_at: null, summary_posted_at: null, errors: [], cost_usd: 4.25 },
      { owner: "suuchi", list_date: TODAY, status: "ready", rows: [{ aiFit: { score: 52 } }, { aiFit: { score: 88 } }], attempts: 18, sent_count: 3, held_count: 1, announced_at: "2026-10-01T11:00:00Z", summary_posted_at: null, errors: [{ domain: "a.test", reason: "AI fit 20 is below 40" }], cost_usd: 2.15 },
    ],
  };
  const route = settingsRoute({ owner: "suuchi", role: "member", name: "Suuchi" }, tables, []);
  const data = await (await route.GET(new Request("https://test"))).json();
  assert.equal(data.seats.length, 1);
  assert.deepEqual(data.night, { costUsd: 6.4, budgetUsd: 10 });
  const today = data.seats[0].today;
  assert.equal(today.attempts, 18);
  assert.equal(today.target, 20);
  assert.deepEqual(today.fit, { min: 52, median: 70, max: 88 });
  assert.deepEqual(today.skipBuckets, [{ bucket: "low fit", count: 1 }]);
  assert.equal(data.seats[0].daysConnected, 2);
  assert.equal(data.seats[0].dailyCap, 15);
});

function cardsRoute(user: Row, card: Row, writes: Row[]) {
  const db = {
    from() {
      let pending: Row | null = null;
      const query = {
        select: () => query, eq: () => query, in: () => query,
        update: (value: Row) => { pending = value; return query; },
        single: async () => ({ data: card, error: null }),
        maybeSingle: async () => { if (!pending) return { data: card, error: null }; writes.push(pending); Object.assign(card, pending); return { data: { ...card }, error: null }; },
      };
      return query;
    },
  };
  return load("../app/api/cards/[id]/route.ts", {
    "@/lib/restore-selected-draft": { restoreSelectedDraft: async () => "new" }, "@/lib/focus-data": {}, "@/lib/version-tracking": {}, "@/lib/version-attribution": {},
    "@/lib/outreach-variants": {}, "@/lib/sender": {}, "@/lib/email-style": { emailStyle: (value: string) => value },
    "@/lib/auth": { requireUser: async () => user }, "@/lib/supabase/admin": { admin: () => db },
  });
}
const patch = (route: Record<string, Handler>, body: Row) => route.PATCH(new Request("https://test/api/cards/card", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "card" }) });

test("the card's owner can keep it for themselves and put it back", async () => {
  const card = { id: "card", status: "new", assigned_to: "suuchi", auto_send_hold: false };
  const writes: Row[] = [];
  const route = cardsRoute({ owner: "suuchi", role: "member" }, card, writes);
  const response = await patch(route, { auto_send_hold: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).auto_send_hold, true);
  assert.equal(JSON.stringify(writes[0]), JSON.stringify({ auto_send_hold: true }));
  assert.equal(writes[0].status, undefined, "holding a card never changes its status");
  await patch(route, { auto_send_hold: false });
  assert.equal(card.auto_send_hold, false);
});

test("someone else cannot change a card's auto-send hold", async () => {
  const card = { id: "card", status: "new", assigned_to: "josh", auto_send_hold: false };
  const writes: Row[] = [];
  const response = await patch(cardsRoute({ owner: "suuchi", role: "member" }, card, writes), { auto_send_hold: true });
  assert.equal(response.status, 403);
  assert.equal(writes.length, 0);
  assert.equal(card.auto_send_hold, false);
});
