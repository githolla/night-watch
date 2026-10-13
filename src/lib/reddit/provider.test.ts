import test from "node:test";
import assert from "node:assert/strict";
import { parseComments, parsePost, RedditProvider } from "./provider.ts";
const post = { id: "abc", subreddit: "smallbusiness", permalink: "/r/smallbusiness/comments/abc/example/", title: "Reporting help", selftext: "How do I automate reporting?", created_utc: 1791892800, author: "pseudonym", locked: false };
const approved = Object.fromEntries(["REDDIT_COMMERCIAL_APPROVAL_REFERENCE", "REDDIT_USER_AGENT", "REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_REFRESH_TOKEN", "ANTHROPIC_API_KEY"].map((key) => [key, "test-value"]));
const listing = (children: unknown[], after: string | null = null) => ({ data: { children, after } });
const child = (data: unknown, kind = "t3") => ({ kind, data });

test("unapproved access makes zero network calls", async () => {
  let calls = 0;
  const fake: typeof fetch = async () => { calls++; return Response.json({}); };
  await assert.rejects(new RedditProvider(AbortSignal.timeout(1000), fake, {}).search("CRM", ["smallbusiness"], 0), /not configured/);
  assert.equal(calls, 0);
});
test("provider rejects arbitrary URLs and removes identity handles from stored sources", () => {
  const row = parsePost(post);
  assert.equal("author" in row, false);
  assert.equal(row.permalink, `https://www.reddit.com${post.permalink}`);
  assert.throws(() => parsePost({ ...post, permalink: "https://evil.test/steal" }), /permalink/);
  assert.equal(parsePost({ ...post, author: "[deleted]" }).deleted, true);
  assert.equal(parsePost({ ...post, archived: true }).locked, true);
});
test("nested author clarifications are retained, removed comments are not, omitted branches mark partial", () => {
  const result = parseComments(listing([child({ id: "a", body: "I run operations", author: "hidden", is_submitter: true, replies: listing([child({ id: "b", body: "[deleted]", author: "[deleted]" }, "t1"), child({}, "more")]) }, "t1")]));
  assert.deepEqual(result.comments, [{ id: "a", text: "I run operations", is_author: true }]);
  assert.equal(result.partial, true);
});
test("pagination stays bounded and reports incomplete search coverage", async () => {
  let reads = 0;
  const paths: string[] = [];
  const fake: typeof fetch = async (input) => {
    paths.push(String(input));
    if (String(input).includes("access_token")) return Response.json({ access_token: "token", scope: "read" });
    reads++;
    return Response.json(listing([child({ ...post, id: String(reads), permalink: `/r/smallbusiness/comments/${reads}/example/` })], "next"));
  };
  const provider = new RedditProvider(AbortSignal.timeout(1000), fake, approved);
  const result = await provider.search("CRM", ["smallbusiness"], 0);
  assert.equal(result.partial, true); assert.equal(reads, 2);
  assert.ok(paths.slice(1).every((path) => path.startsWith("https://oauth.reddit.com/r/smallbusiness/search")));
});
test("rate limits stop additional reads and 403 never falls back to scraping", async () => {
  let calls = 0;
  const fake: typeof fetch = async (input) => {
    calls++;
    if (String(input).includes("access_token")) return Response.json({ access_token: "token", scope: "read" });
    return Response.json(listing([]), { headers: { "x-ratelimit-remaining": "0" } });
  };
  const provider = new RedditProvider(AbortSignal.timeout(1000), fake, approved);
  await provider.search("CRM", ["smallbusiness"], 0);
  await assert.rejects(provider.search("CRM", ["smallbusiness"], 0), /allowance/);
  assert.equal(calls, 2);
  const refused: typeof fetch = async (input) => String(input).includes("access_token") ? Response.json({ access_token: "token", scope: "read" }) : new Response("", { status: 403 });
  await assert.rejects(new RedditProvider(AbortSignal.timeout(1000), refused, approved).thread("abc"), /403/);
});
