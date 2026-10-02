import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
type Prepare = (domain: string, me: unknown, db: unknown) => Promise<Response>;
type Row = Record<string, unknown>;

function load(mocks: Record<string, unknown>): Prepare {
  const source = readFileSync(new URL("./prepare-priority-draft.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, Prepare> = {};
  runInNewContext(output, {
    exports, Error, Response, URL, Date,
    require: (name: string) => {
      if (name === "zod") return require("zod");
      if (name in mocks) return mocks[name];
      throw new Error(`Unmocked dependency ${name}`);
    },
  });
  return exports.preparePriorityDraft;
}

/** Answers each table with one fixed row and records the signal written. */
function fakeDb(signals: Row[]) {
  const rows: Record<string, Row> = {
    accounts: { id: "account", status: "active" },
    people: { id: "person", full_name: "John Smith", title: "CEO", email: null, do_not_contact: false },
    signals: { id: "signal" },
    cards: { id: "card", status: "new", dismiss_reason: null, score_breakdown: {} },
  };
  return {
    from(table: string) {
      const result = { data: rows[table] ?? null, error: null, count: 0 };
      const query = {
        select: () => query, eq: () => query, ilike: () => query, is: () => query, update: () => query, insert: () => query,
        upsert: (value: Row) => { if (table === "signals") signals.push(value); return query; },
        single: async () => result, maybeSingle: async () => result,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(resolve(result)),
      };
      return query;
    },
  };
}

function selected(date: string | null) {
  return {
    company: "Acme Landscaping, LLC", domain: "acmeland.com", sector: "landscaping", researchDate: "2026-10-01", hypothesis: "Proposed workflow: crew schedules.", fit: "AI fit 60/100",
    buyer: { name: "John Smith", title: "CEO" },
    trigger: { fact: "Acme acquired Green Turf Services in August 2026", sourceUrl: "https://news.example.com/acme", date },
  };
}

function mocks(row: ReturnType<typeof selected>) {
  return {
    "./curated-card-state.ts": { wasAutomaticallyArchived: () => false },
    "@/lib/supabase/admin": { admin: () => { throw new Error("pass a db"); } },
    "./focus-data.ts": { allFocus: () => [row], batchOwner: () => "josh" },
    "./outreach-variants.ts": { savedVariants: () => [], renderSavedVariant: () => ({ subject: "", body: "" }), renderLinkedInVariant: () => null },
    "@/lib/recipient-research": { domainKey: (value: string) => value.toLowerCase() },
    "@/lib/sender": { senderProfile: async () => ({ fromName: "Josh", title: "Founder", greeting: "Hi", signoff: "Thanks", intro: "" }) },
    "@/lib/contact-draft": { composeContactDraft: () => ({ subject: "Subject", body: "Body" }) },
    "./focused-contact.ts": { focusedContacts: () => [], publishedEmailPatch: () => ({}) },
  };
}

test("a dated trigger is stored as the source's publish date; observed_at stays the research date", async () => {
  const signals: Row[] = [];
  const row = selected("2026-08-15");
  const response = await load(mocks(row))("acmeland.com", { owner: "josh" }, fakeDb(signals));
  assert.equal(response.status, 200);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].observed_at, "2026-10-01");
  assert.equal(JSON.stringify((signals[0].raw as Row).source), JSON.stringify({ published_at: "2026-08-15" }));
});

test("an undated trigger writes no source date", async () => {
  const signals: Row[] = [];
  await load(mocks(selected(null)))("acmeland.com", { owner: "josh" }, fakeDb(signals));
  assert.equal((signals[0].raw as Row).source, undefined);
});
