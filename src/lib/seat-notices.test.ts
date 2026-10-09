import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as rules from "./morning-send-rules.ts";
import * as text from "./seat-notice-text.ts";
import { localParts } from "./local-time.ts";

type Row = Record<string, unknown>;
type Module = typeof import("./seat-notices.ts");

/** Notices with a fake database that can refuse a duplicate claim, and a Gmail that records what it sent. */
function harness(options: { noTable?: boolean; autoSend?: boolean; going?: number; sentToday?: number } = {}) {
  const claims = new Set<string>();
  const sent: Array<{ owner: string; to: string; subject: string }> = [];
  const db = {
    from(table: string) {
      const filters: Row = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        delete: () => { const del = { eq: (key: string, value: unknown) => { filters[key] = value; if (Object.keys(filters).length === 3) claims.delete(`${filters.owner}:${filters.kind}:${filters.key}`); return del; } }; return del; },
        maybeSingle: async () => ({ data: table === "gmail_connections" ? { email: `${filters.owner}@nine-67.com` } : table === "sender_profiles" ? { from_name: filters.owner === "josh" ? "Josh Lee" : "Suuchi Ramesh" } : null }),
        insert: async (row: Row) => {
          if (options.noTable) return { error: { code: "PGRST205", message: "Could not find the table 'public.seat_notifications'" } };
          const key = `${row.owner}:${row.kind}:${row.key}`;
          if (claims.has(key)) return { error: { code: "23505", message: "duplicate" } };
          claims.add(key);
          return { error: null };
        },
      };
      return query;
    },
  };
  const source = readFileSync(new URL("./seat-notices.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  const mocks: Record<string, unknown> = {
    "./autosend-view.ts": { loadAutoSendView: async () => { throw new Error("use deps"); } }, "./gmail.ts": { sendEmail: async () => ({}) },
    "./local-time.ts": { localParts }, "./morning-send-rules.ts": rules, "./opt-out.ts": { configuredBaseUrl: () => "https://app.test" },
    "./seat-notice-text.ts": text, "./sent-view.ts": { loadSentView: async () => { throw new Error("use deps"); } },
  };
  runInNewContext(output, { exports, Date, Error, Promise, require: (name: string) => { if (name in mocks) return mocks[name]; throw new Error(`Unmocked ${name}`); } });
  const going = options.going ?? 2;
  const deps = {
    send: async (owner: string, _from: string, to: string, subject: string) => { sent.push({ owner, to, subject }); return { id: "m", threadId: "t" }; },
    autoSendView: async () => ({
      plan: { when: "today", dayLabel: "today", windowLabel: "9:00am to 11:30am", going, later: 0, held: 0, blocker: null, dailyCap: 40, sentToday: 0 },
      control: { autoSend: options.autoSend ?? true, paused: false, pausedReason: null, postalAddressSet: true, skippedToday: false },
      emails: Array.from({ length: going }, (_, i) => ({ id: `c${i}`, group: "going", time: "9:00am", name: `Person ${i}`, title: "CEO", company: `Co ${i}` })),
    }),
    sentView: async () => ({ sent: options.sentToday ?? 0, firsts: 0, followups: 0, replies: 0, interested: 0, bounced: 0, replyRate: 0, bounceRate: 0, daily: [], mix: { industry: [], role: [], size: [] }, recent: [] }),
  };
  const run = (iso: string) => (exports as unknown as Module).runSeatNotices(db as never, new Date(iso), deps as never);
  return { run, sent, exports: exports as unknown as Module, db };
}

// 2026-10-09 is a Friday; 12:30Z is 8:30am in New York.
test("the heads-up goes once, at 8:30am, to each seat's own inbox", async () => {
  const h = harness();
  await h.run("2026-10-09T12:30:00Z");
  await h.run("2026-10-09T12:31:00Z");
  assert.deepEqual(h.sent.map((item) => [item.owner, item.to]), [["josh", "josh@nine-67.com"], ["suuchi", "suuchi@nine-67.com"]]);
  assert.match(h.sent[0].subject, /^Auto-send today: 2 emails/);
  await h.run("2026-10-09T12:40:00Z");
  assert.equal(h.sent.length, 2, "outside the slot nothing goes");
});

test("no heads-up when auto-send is off or nothing is going", async () => {
  const off = harness({ autoSend: false });
  await off.run("2026-10-09T12:30:00Z");
  assert.equal(off.sent.length, 0);
  const empty = harness({ going: 0 });
  await empty.run("2026-10-09T12:30:00Z");
  assert.equal(empty.sent.length, 0);
});

test("before migration 0032 the slot alone keeps it to one per run", async () => {
  const h = harness({ noTable: true });
  await h.run("2026-10-09T12:30:00Z");
  assert.equal(h.sent.length, 2);
});

test("the recap only goes when something was sent, and the Friday note at noon", async () => {
  const none = harness({ sentToday: 0 });
  await none.run("2026-10-09T15:40:00Z");
  assert.equal(none.sent.length, 0);
  const some = harness({ sentToday: 3 });
  await some.run("2026-10-09T15:40:00Z");
  assert.match(some.sent[0].subject, /^Auto-send recap: 0 emails sent this morning|^Auto-send recap/);
  await some.run("2026-10-09T16:00:00Z");
  assert.ok(some.sent.some((item) => /^Your week:/.test(item.subject)));
});

test("a reply alert never throws, and skips auto-replies", async () => {
  const h = harness();
  const sent: string[] = [];
  const send = async (_o: string, _f: string, _t: string, subject: string) => { sent.push(subject); return {}; };
  assert.equal(await h.exports.sendReplyAlert(h.db as never, { owner: "suuchi", cardId: "c1", name: "Dana Ortiz", title: "CEO", company: "Acme", classification: "ooo", body: "Away" }, send as never), false);
  assert.equal(await h.exports.sendReplyAlert(h.db as never, { owner: "suuchi", cardId: "c1", name: "Dana Ortiz", title: "CEO", company: "Acme", classification: "positive", body: "Yes please.\n\nOn Mon, Oct 5, 2026 Suuchi wrote:\n> hi" }, send as never), true);
  assert.deepEqual(sent, ["Reply from Dana Ortiz (Acme): interested"]);
  const failing = async () => { throw new Error("Gmail down"); };
  assert.equal(await h.exports.sendReplyAlert(h.db as never, { owner: "suuchi", cardId: "c1", name: "Dana", title: null, company: "Acme", classification: "negative", body: "No" }, failing as never), false);
});
