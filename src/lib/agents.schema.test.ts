import assert from "node:assert/strict";
import test from "node:test";
import { scoutOutput } from "./agents.ts";

const base = {
  type: "exec_post",
  summary: "CEO posted about automating claims intake",
  source_url: "https://www.linkedin.com/posts/example",
  observed_at: "2026-09-06",
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
