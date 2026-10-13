import test from "node:test";
import assert from "node:assert/strict";
import { DiscoveryCollector, feedItems } from "./providers.ts";
import { defaultConfig, type SourceConfig } from "./domain.ts";
import { now } from "./fixtures.ts";
const feed: SourceConfig = { id: "feed", provider: "feed", label: "Company news", enabled: true, value: "https://company.test/feed", company: "Acme", domain: "acme.com", permission_reference: "Publisher permits commercial feed use" };
function collector(responder: (url: string) => unknown, env: Record<string, string | undefined> = {}) {
  const urls: string[] = [];
  const result = new DiscoveryCollector(AbortSignal.timeout(1000), { env, lookup: async () => ["8.8.8.8"], fetcher: async (url) => { urls.push(String(url)); const value = responder(String(url)); return typeof value === "string" ? new Response(value) : Response.json(value); } });
  return { collector: result, urls };
}
test("RSS and Atom preserve attribution and avoid unsupported company inference", () => {
  const rss = '<rss><channel><item><guid>one</guid><title>New operations center</title><link>https://acme.com/news</link><description><![CDATA[<p>Acme opens a new office.</p>]]></description><pubDate>Tue, 13 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>';
  const rows = feedItems(rss, feed, now); assert.equal(rows[0].text, "Acme opens a new office."); assert.equal(rows[0].company, "Acme"); assert.equal(rows[0].url, "https://acme.com/news");
  const atom = '<feed><entry><id>two</id><title>Reporting change</title><link rel="alternate" href="https://acme.com/reporting"/><summary>New reporting process</summary><updated>2026-10-13T08:00:00Z</updated></entry></feed>';
  assert.equal(feedItems(atom, { ...feed, company: "", domain: "" }, now)[0].company, null);
});
test("feeds reject entity expansion and Reddit links", () => {
  assert.throws(() => feedItems('<!DOCTYPE rss [<!ENTITY x "oops">]><rss/>', feed, now), /unsafe/);
  assert.equal(feedItems('<rss><channel><item><title>Reddit</title><link>https://www.reddit.com/r/test/comments/abc</link></item></channel></rss>', feed, now).length, 0);
});
test("a feed without permission, or a Reddit RSS URL, causes zero reads", async () => {
  const h = collector(() => "<rss/>");
  assert.equal((await h.collector.collect({ ...feed, permission_reference: "" }, 5, now, [])).coverage.state, "failed");
  assert.equal((await h.collector.collect({ ...feed, value: "https://www.reddit.com/r/business.rss" }, 5, now, [])).coverage.state, "failed");
  assert.equal(h.urls.length, 0);
});
test("missing SAM and SEC configuration skips only those sources", async () => {
  const h = collector(() => ({}));
  assert.equal((await h.collector.collect(defaultConfig.sources[2], 10, now, [])).coverage.state, "skipped");
  assert.equal((await h.collector.collect({ ...feed, provider: "sec", value: "123" }, 10, now, [])).coverage.state, "skipped");
  assert.equal(h.urls.length, 0);
});
test("news collection keeps titles as metadata without fetching publisher articles", async () => {
  const h = collector(() => ({ articles: [{ url: "https://publisher.test/acme", title: "Acme expands operations", seendate: "20261013T120000Z" }] }));
  const result = await h.collector.collect(defaultConfig.sources[0], 10, now, []);
  assert.equal(result.items[0].published_at, null); assert.equal(result.items[0].company, null); assert.equal(result.items[0].partial, true);
  assert.equal(h.urls.length, 1); assert.match(h.urls[0], /^https:\/\/api.gdeltproject.org/);
});
test("job collection filters unrelated roles and distinguishes publication from board updates", async () => {
  const h = collector(() => ({ jobs: [{ id: 1, title: "CRM Administrator", absolute_url: "https://boards.greenhouse.io/acme/jobs/1", content: "Maintain reporting and integrations", updated_at: "2026-10-13" }, { id: 2, title: "Warehouse Driver", absolute_url: "https://boards.greenhouse.io/acme/jobs/2" }] }));
  const result = await h.collector.collect({ ...feed, provider: "greenhouse", value: "acme" }, 10, now, []);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].published_at, null); assert.equal(result.items[0].kind, "hiring");
});
test("Hacker News collection drops deleted posts and retains no username or inferred identity", async () => {
  const h = collector((url) => url.includes("askstories") ? [1, 2] : url.includes("/1.json") ? { id: 1, title: "Ask HN: CRM reporting help", text: "Manual reporting takes hours", time: now / 1000, by: "pseudonym", kids: [3] } : { id: 2, title: "Reporting", time: now / 1000, deleted: true });
  const result = await h.collector.collect(defaultConfig.sources[1], 5, now, ["reporting"]);
  assert.equal(result.items.length, 1); assert.equal("by" in result.items[0], false); assert.equal(result.items[0].company, null); assert.equal(result.coverage.state, "partial");
});
test("SEC form metadata does not manufacture funding amounts or acquisitions", async () => {
  const h = collector(() => ({ filings: { recent: { accessionNumber: ["0000000123-26-000001"], filingDate: ["2026-10-13"], form: ["8-K"], primaryDocument: ["event.htm"] } } }), { SEC_USER_AGENT: "NightWatch ops@example.com" });
  const result = await h.collector.collect({ ...feed, provider: "sec", value: "123" }, 5, now, []);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].partial, true); assert.match(result.items[0].text, /does not by itself/);
});
test("SAM filters expired categories and retains deadlines without treating agency contacts as leads", async () => {
  const h = collector(() => ({ totalRecords: 1, opportunitiesData: [{ noticeId: "abc", title: "CRM reporting integration", postedDate: "2026-10-12", active: "Yes", type: "Solicitation", responseDeadLine: "2026-10-20T12:00:00Z", fullParentPathName: "Agency", pointOfContact: [{ email: "contracting@example.gov" }] }] }), { SAM_API_KEY: "secret-test" });
  const result = await h.collector.collect(defaultConfig.sources[2], 5, now, ["CRM"]);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].deadline, "2026-10-20T12:00:00.000Z"); assert.equal(result.items[0].company, null);
  assert.equal(JSON.stringify(result).includes("secret-test"), false); assert.equal(JSON.stringify(result).includes("contracting@example.gov"), false);
});
test("private-address feeds are refused before a network request", async () => {
  let reads = 0;
  const collector = new DiscoveryCollector(AbortSignal.timeout(1000), { lookup: async () => ["127.0.0.1"], fetcher: async () => { reads++; return new Response("<rss/>"); } });
  assert.equal((await collector.collect(feed, 5, now, [])).coverage.state, "failed"); assert.equal(reads, 0);
});
test("truncated job and discussion content remains explicitly partial", async () => {
  const job = collector(() => [{ id: "job", text: "CRM Administrator", hostedUrl: "https://jobs.lever.co/acme/job", descriptionPlain: "x".repeat(21000) }]);
  const result = await job.collector.collect({ ...feed, provider: "lever", value: "acme" }, 5, now, []);
  assert.equal(result.items[0].text.length, 20000); assert.equal(result.items[0].partial, true);
  const discussion = collector((url) => url.includes("askstories") ? [1] : { id: 1, title: "CRM reporting", text: "x".repeat(21000), time: now / 1000 });
  assert.equal((await discussion.collector.collect(defaultConfig.sources[1], 5, now, ["CRM"])).items[0].partial, true);
});
