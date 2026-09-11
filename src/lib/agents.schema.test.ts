import assert from "node:assert/strict";
import test from "node:test";
import { disqualifySignal, scoutOutput } from "./agents.ts";

const base = {
  type: "exec_post",
  summary: "CEO posted about automating claims intake",
  source_url: "https://www.linkedin.com/posts/example",
  observed_at: "2026-09-06",
  operating_need: "Automate claims intake triage instead of hiring two intake analysts",
  confidence: 0.8,
};

test("a source without published_at or author still validates", () => {
  const parsed = scoutOutput.parse({ signals: [{ ...base, type: "new_leader", source: { headline: "New COO appointed", publisher: "Business Wire", excerpt: "…" } }] });
  assert.equal(parsed.signals[0].source?.published_at, null);
  assert.equal(parsed.signals[0].source?.author_name, null);
});

test("a post without published_at or author_title still validates", () => {
  const parsed = scoutOutput.parse({ signals: [{ ...base, post: { text: "We are automating intake.", author_name: "Dana Whitfield" } }] });
  assert.equal(parsed.signals[0].post?.published_at, null);
  assert.equal(parsed.signals[0].post?.author_title, "");
});

test("an ISO datetime in observed_at is trimmed to its date", () => {
  const parsed = scoutOutput.parse({ signals: [{ ...base, observed_at: "2026-09-06T14:00:00Z" }] });
  assert.equal(parsed.signals[0].observed_at, "2026-09-06");
});

test("a non-date observed_at is rejected with a path the desk can show", () => {
  assert.throws(() => scoutOutput.parse({ signals: [{ ...base, observed_at: "August 2026" }] }), (error: unknown) => {
    const issues = (error as { issues?: Array<{ path: PropertyKey[] }> }).issues ?? [];
    return issues[0]?.path.join(".") === "signals.0.observed_at";
  });
});

test("a non-http source_url is rejected", () => {
  assert.throws(() => scoutOutput.parse({ signals: [{ ...base, source_url: "ftp://example.com/x" }] }));
});

test("a signal without an operating need does not validate", () => {
  const { operating_need: _dropped, ...withoutNeed } = base;
  void _dropped;
  assert.throws(() => scoutOutput.parse({ signals: [withoutNeed] }));
  assert.throws(() => scoutOutput.parse({ signals: [{ ...base, operating_need: "   " }] }));
});

test("an executive opinion piece is dropped even when typed as exec_post", () => {
  const opEd = scoutOutput.parse({ signals: [{ ...base, source_url: "https://www.forbes.com/sites/example/ai-compute-economics", source: { headline: "The economics of AI", publisher: "Forbes" } }] }).signals[0];
  assert.match(disqualifySignal(opEd) ?? "", /without the actual post text/);
  const forbesPost = scoutOutput.parse({ signals: [{ ...base, source_url: "https://www.forbes.com/sites/example/x", post: { text: "…", author_name: "A CEO" } }] }).signals[0];
  assert.match(disqualifySignal(forbesPost) ?? "", /opinion piece/);
});

test("an operator asking for help with the real post text qualifies", () => {
  const item = scoutOutput.parse({ signals: [{ ...base, evidence_kind: "asking_for_help", post: { text: "Anyone found a way to triage 400 intake emails a day without adding headcount?", author_name: "Dana Whitfield", author_title: "Director of Operations" } }] }).signals[0];
  assert.equal(disqualifySignal(item), null);
});

test("a job signal must name the role", () => {
  const cluster = { ...base, type: "job_cluster" as const, source_url: "https://example.com/careers" };
  assert.match(disqualifySignal(scoutOutput.parse({ signals: [cluster] }).signals[0]) ?? "", /role title/);
  const named = { ...cluster, job: { title: "RevOps Analyst", department: "Revenue", days_open: 41, reposted: true, salary_max: 95000, tools_named: ["HubSpot"], responsibilities: ["Clean pipeline data"] } };
  assert.equal(disqualifySignal(scoutOutput.parse({ signals: [named] }).signals[0]), null);
});

test("an AI post by a named employee qualifies; the same words in a trade-press column do not", () => {
  const post = scoutOutput.parse({ signals: [{ ...base, evidence_kind: "ai_post", source_url: "https://www.linkedin.com/posts/jane-doe_ai-activity-1", post: { text: "We put an agent on intake triage last month. It handles 60% of tickets; the rest still need a human.", author_name: "Jane Doe", author_title: "Director of Operations" } }] }).signals[0];
  assert.equal(disqualifySignal(post), null);
  const column = scoutOutput.parse({ signals: [{ ...base, evidence_kind: "ai_post", source_url: "https://www.forbes.com/sites/janedoe/ai-triage", post: { text: "We put an agent on intake triage last month.", author_name: "Jane Doe", author_title: "Director of Operations" } }] }).signals[0];
  assert.match(disqualifySignal(column) ?? "", /opinion piece/);
});
