import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { queryDb } from "./testing/query-db.ts";

type Row = Record<string, unknown>;
type Module = typeof import("./address-sweep.ts");

function load(people: Row[], finder: (input: { name: string; domain: string; avoid?: string | null }) => Promise<Row>) {
  const { db, tables } = queryDb({ people: people.map((p) => ({ id: p.personId, email_check: p.check ?? null, email_status: p.emailStatus })) });
  const searched: string[] = [];
  const imported: Row[] = [];
  const source = readFileSync(new URL("./address-sweep.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  const mocks: Record<string, unknown> = {
    "./address-finder.ts": { findAddress: async (input: { name: string; domain: string; avoid?: string | null }) => { searched.push(`${input.name}|${input.avoid ?? ""}`); return finder(input); } },
    "./nightly-list-builder.ts": { addressesToWork: async () => people, importAddressEvidence: async (_db: unknown, items: Row[]) => { imported.push(...items); return [{ address: (items[0].emailEvidence as Row).address, outcome: "likely", reason: "matches" }]; } },
    "./recipient-verification.ts": { domainAcceptsMail: async () => true },
  };
  runInNewContext(output, { exports, Date, Error, Promise, require: (name: string) => { if (name in mocks) return mocks[name]; throw new Error(`Unmocked ${name}`); } });
  return { sweep: exports as unknown as Module, db, tables, searched, imported };
}

const person = (personId: string, extra: Row = {}) => ({ owner: "josh", personId, name: `Person ${personId}`, title: "CEO", company: "Co", domain: `${personId}.test`, email: `x@${personId}.test`, emailStatus: "unverified", emailSource: "pattern", ...extra });

test("bounced people go first, then Suuchi's, then Josh's; a bounced address is never offered back", async () => {
  const h = load([person("j1"), person("s1", { owner: "suuchi" }), person("b1", { emailStatus: "invalid", email: "bad@b1.test" })], async () => ({ kind: "none", pagesRead: 3, addressesSeen: 0 }));
  await h.sweep.runAddressSweep(h.db as never, { now: new Date("2026-10-09T20:00:00Z") });
  assert.deepEqual(h.searched, ["Person b1|bad@b1.test", "Person s1|", "Person j1|"]);
});

test("found evidence goes through the app's own check; a domain with no mail marks the guess bad; searches are remembered", async () => {
  const h = load([person("a"), person("d")], async (input) => input.domain === "d.test" ? { kind: "no-mail" } : { kind: "evidence", evidence: { kind: "published", address: "pat@a.test", sourceUrl: "https://a.test/team" } });
  const out = await h.sweep.runAddressSweep(h.db as never, { now: new Date("2026-10-09T20:00:00Z") });
  assert.equal(h.imported.length, 1);
  assert.match(out[0].result, /^likely: pat@a\.test/);
  const dead = h.tables.people.find((row) => row.id === "d")!;
  assert.equal(dead.email_status, "invalid");
  assert.match(String((dead.email_check as Row).reason), /does not accept email/);
});

test("someone searched in the last week is skipped", async () => {
  const h = load([person("r", { check: { searchedAt: "2026-10-08T00:00:00Z" } }), person("o", { check: { searchedAt: "2026-09-20T00:00:00Z" } })], async () => ({ kind: "none", pagesRead: 1, addressesSeen: 0 }));
  await h.sweep.runAddressSweep(h.db as never, { now: new Date("2026-10-09T20:00:00Z") });
  assert.deepEqual(h.searched, ["Person o|"]);
  assert.equal(((h.tables.people.find((row) => row.id === "o")!.email_check) as Row).searchedAt, "2026-10-09T20:00:00.000Z");
});
