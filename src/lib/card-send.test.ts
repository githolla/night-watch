import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as deliveryState from "./delivery-state.ts";
import * as suppression from "./email-suppression.ts";
import * as rules from "./morning-send-rules.ts";
import { emailMime } from "./email-mime.ts";
import * as ending from "./outreach-ending.ts";
import { withOptOut } from "./opt-out.ts";
import { recipientAllowed } from "./recipient-verification.ts";
import { bulkSendable } from "./bulk-sendable.ts";
import { isRealContact } from "./clean.ts";
import { queryDb } from "./testing/query-db.ts";

type Row = Record<string, unknown>;
type SendInput = { cardId: string; owner: string; subject: string; body: string; baseUrl: string; automatic?: boolean };
type Module = {
  sendCardEmail: (db: unknown, input: SendInput) => Promise<Record<string, unknown>>;
  followupContext: (card: { accounts?: { name?: string | null } | null }, focused: unknown) => { company: string; task?: string; metric?: string };
};

const SIGNATURE = `<p>Suuchi Ramesh<br><img src="https://cdn.example.com/logo.png" alt="Nine-67"><br><a href="https://nine-67.com">Nine-67</a> | <a href="https://www.linkedin.com/in/suuchi">LinkedIn</a></p>`;

function harness(options: { cardExtra?: Row; people?: Row[]; focus?: Row[]; recipient?: "deliverable" | "risky" | "undeliverable" } = {}) {
  const gmail: Array<{ text: string; html: string }> = [];
  const followups: Row[] = [];
  const { db, tables } = queryDb({
    cards: [{ id: "card", status: "edited", person_id: "p1", account_id: "acct", assigned_to: "suuchi", auto_send_hold: false, people: { id: "p1", full_name: "Dana Ortiz", email: "dana.ortiz@acme.test", email_status: "verified", do_not_contact: false }, accounts: { id: "acct", name: "Acme Landscaping, LLC", domain: "acme.test", status: "prospect" }, ...options.cardExtra }],
    people: options.people ?? [{ id: "p1", email: "dana.ortiz@acme.test", do_not_contact: false }],
    gmail_connections: [{ owner: "suuchi", email: "suuchi@nine-67.test", connected_at: "2026-01-01T00:00:00Z" }],
    touches: [], message_experiments: [],
  });
  const mocks: Record<string, unknown> = {
    "@/lib/mailbox-quota": { withMailboxQuota: async (_db: unknown, _input: unknown, fn: () => unknown) => fn() },
    "@/lib/delivery-state": deliveryState,
    "@/lib/restore-selected-draft": { restoreSelectedDraft: async () => "edited" },
    "@/lib/focus-data": { assertCardSender: () => {}, allFocus: () => options.focus ?? [] },
    "@/lib/email-suppression": suppression,
    "@/lib/morning-send-rules": rules,
    "@/lib/bulk-sendable": { bulkSendable },
    "@/lib/recipient-verification": { checkRecipient: async () => ({ level: options.recipient ?? "deliverable", reason: "Verified address.", suggestion: null }), recipientAllowed, recordRecipientCheck: async () => {}, recordDelivery: async () => {} },
    "@/lib/opt-out": { withOptOut, unsubscribeUrl: () => "https://app.test/api/unsubscribe?t=x" },
    "@/lib/first-touch": { firstTouchErrors: () => [] },
    "@/lib/authored-sender": { authoredSenderDraft: ({ body }: { body: string }) => ({ body, senderConflict: null }) },
    "@/lib/version-tracking": { trackEmailVersion: async () => "variant" },
    "@/lib/gmail": { sendEmail: async (...args: unknown[]) => { gmail.push({ text: String(args[4]), html: String(args[7]) }); return { id: "message", threadId: "thread" }; } },
    "@/lib/followups": { ensureFollowupCadence: async (_db: unknown, ctx: Row) => { followups.push(ctx); return { created: true, steps: 2 }; } },
    "@/lib/send-action": { sendInput: { parse: (value: unknown) => value }, validateEmail: () => {} },
    "@/lib/send-guards": { dailyCap: () => 20, sendDayStart: () => new Date("2026-10-01T04:00:00Z") },
    "@/lib/sender": { sanitizeLinks: (value: string) => value, senderProfile: async () => ({ fromName: "Suuchi", signature: SIGNATURE, postalAddress: "1 Main St, Austin TX", cc: [], greeting: "Hi {first}," }), fromHeader: () => "Suuchi" },
    "@/lib/curated-worklist": { isCuratedDomain: () => false },
    "@/lib/clean": { isRealContact },
    "@/lib/outreach-ending": ending,
    "@/lib/nightly-lists": { loadNightlyLists: async () => {} },
  };
  const source = readFileSync(new URL("./card-send.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(output, { exports, Date, Error, console, process, require: (name: string) => { if (name in mocks) return mocks[name]; throw new Error(`Unmocked ${name}`); } });
  const loaded = exports as unknown as Module;
  const send = (automatic: boolean) => loaded.sendCardEmail(db, { cardId: "card", owner: "suuchi", subject: "An idea for Acme", body: "Hi Dana,\n\nWould this help?", baseUrl: "https://app.test", automatic });
  return { send, loaded, gmail, followups, tables };
}

test("an automatic send refuses a card kept for sending by hand; a person can still send it", async () => {
  const auto = harness({ cardExtra: { auto_send_hold: true } });
  await assert.rejects(auto.send(true), /Kept for sending by hand/);
  assert.equal(auto.gmail.length, 0);
  const manual = harness({ cardExtra: { auto_send_hold: true } });
  assert.equal((await manual.send(false)).ok, true);
  assert.equal(manual.gmail.length, 1);
});

test("an address opted out on another people row is refused, by hand too", async () => {
  const h = harness({ people: [{ id: "p1", email: "dana.ortiz@acme.test", do_not_contact: false }, { id: "old", email: "Dana.Ortiz@ACME.test", do_not_contact: true }] });
  await assert.rejects(h.send(false), /opted out/);
  assert.equal(h.gmail.length, 0);
});

test("an automatic send carries the text signature: no image, no extra links, no multipart/related", async () => {
  const auto = harness();
  await auto.send(true);
  const { text, html } = auto.gmail[0];
  assert.doesNotMatch(html, /<img|cid:|data:image/i);
  assert.ok(rules.deliveredLinks(text, html).length <= 1);
  assert.match(html, /Suuchi Ramesh/);
  assert.doesNotMatch(emailMime({ from: "Suuchi <suuchi@nine-67.test>", to: "dana.ortiz@acme.test", subject: "An idea", body: text, html }), /multipart\/related/);
  const manual = harness();
  await manual.send(false);
  assert.match(manual.gmail[0].html, /<img/, "a person's send keeps the saved signature");
});

test("follow-ups get the speakable name and only a nightly row's workflow", async () => {
  const h = harness({ focus: [{ domain: "acme.test", workflow: { task: "branch service follow-up", metric: "time spent chasing updates" } }] });
  await h.send(true);
  assert.equal(h.followups[0].company, "Acme Landscaping");
  assert.equal(h.followups[0].task, "branch service follow-up");
  assert.equal(h.followups[0].metric, "time spent chasing updates");
  const context = h.loaded.followupContext;
  assert.equal(JSON.stringify(context({ accounts: { name: "Acme Landscaping, LLC" } }, { reframe: "service follow-up" })), JSON.stringify({ company: "Acme Landscaping" }));
  assert.equal(JSON.stringify(context({ accounts: { name: "Beta Corp." } }, { workflow: { task: "  ", metric: "hours" } })), JSON.stringify({ company: "Beta" }));
  assert.equal(context({ accounts: null }, null).company, "");
  assert.equal(context({ accounts: { name: "Gamma Holdings Inc" } }, undefined).company, "Gamma Holdings");
});

test("an automatic send takes an unconfirmed guess like Send all ready, but never a known-bad address", async () => {
  const person = { id: "p1", full_name: "Dana Ortiz", email: "dana.ortiz@acme.test", email_status: "unverified", do_not_contact: false };
  const guess = harness({ recipient: "risky", cardExtra: { people: { ...person, email_check: { level: "risky", reason: "Not confirmed." } } } });
  assert.equal((await guess.send(true)).ok, true);
  assert.equal(guess.gmail.length, 1);
  const bad = harness({ recipient: "undeliverable", cardExtra: { people: { ...person, email_status: "invalid" } } });
  await assert.rejects(bad.send(true));
  assert.equal(bad.gmail.length, 0);
});

test("a shared mailbox filed as a contact is never emailed, by hand or automatically", async () => {
  const mailbox = { id: "p1", full_name: "Human Resources", email: "human.resources@acme.test", email_status: "verified", do_not_contact: false };
  for (const automatic of [true, false]) {
    const h = harness({ cardExtra: { people: mailbox } });
    await assert.rejects(h.send(automatic), /shared mailbox or a phrase/);
    assert.equal(h.gmail.length, 0);
  }
});
