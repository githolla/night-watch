import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as rules from "./morning-send-rules.ts";
import { queryDb } from "./testing/query-db.ts";

type Row = Record<string, unknown>;

function cron(seed: Record<string, Row[]>) {
  const { db, tables } = queryDb(seed);
  const sent: string[] = [];
  const mocks: Record<string, unknown> = {
    "@/lib/auth": { cronAuthorized: () => true },
    "@/lib/supabase/admin": { admin: () => db },
    "@/lib/followup-delivery": { followupSelect: "*", sendFollowup: async (_db: unknown, step: Row) => { sent.push(String(step.id)); return { ok: true }; } },
    "@/lib/morning-send-rules": rules,
  };
  const source = readFileSync(new URL("../app/api/cron/cadences/route.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  runInNewContext(output, { exports, Date, Error, Response, Map, Set, require: (name: string) => { if (name in mocks) return mocks[name]; throw new Error(`Unmocked ${name}`); } });
  return { run: () => exports.GET(new Request("https://app.test/api/cron/cadences")), sent, tables };
}

const step = (id: string, owner: string, extra: Row = {}) => ({ id, status: "pending", kind: "automatic", channel: "email", scheduled_at: "2026-09-30T10:00:00Z", cadences: { id: `cad-${id}`, status: "active", owner }, ...extra });

test("a paused seat's automatic follow-up waits for a person and is never sent", async () => {
  const h = cron({
    cadence_steps: [step("s1", "josh"), step("s2", "jenna")],
    sender_profiles: [
      { owner: "josh", auto_send: false, auto_send_paused: true, auto_send_paused_reason: "2 first emails bounced in the last 48 hours. Auto-send and automatic follow-ups are paused.", postal_address: "1 Main St" },
      { owner: "jenna", auto_send: false, auto_send_paused: false, postal_address: "1 Main St" },
    ],
  });
  const body = await (await h.run()).json();
  assert.deepEqual(h.sent, ["s2"], "a seat with morning auto-send off still sends its follow-ups");
  const held = h.tables.cadence_steps.find((row) => row.id === "s1")!;
  assert.equal(held.status, "ready");
  assert.match(String(held.error), /paused/);
  assert.equal(body.held, 1);
  assert.equal(body.sent, 1);
});

test("a seat with no postal address holds its automatic follow-ups", async () => {
  const h = cron({ cadence_steps: [step("s1", "josh")], sender_profiles: [{ owner: "josh", auto_send_paused: false, postal_address: "" }] });
  await h.run();
  assert.deepEqual(h.sent, []);
  assert.match(String(h.tables.cadence_steps[0].error), /postal address/);
});
