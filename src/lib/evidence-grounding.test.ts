import assert from "node:assert/strict";
import test from "node:test";
import { aiFitEvidence, aiFitScore } from "./ai-fit.ts";
import { groundEvidence, isJobBoardUrl, isPrivateAddress, normalizeUrl, pageAgeDate, safeFetch, type Fetcher, type Lookup } from "./evidence-grounding.ts";

const now = new Date("2026-10-01T12:00:00Z");
const domain = "acme.com";
const publicLookup: Lookup = async () => ["93.184.216.34"];
const empty = { hiring: [], scale: null, change: [], techOpenness: [], systems: [], disqualifiers: [] };

type Route = { status: number; body?: string; location?: string };
function stubFetcher(routes: Record<string, Route>, calls: string[] = []): Fetcher {
  return async (url) => {
    calls.push(url);
    const route = routes[url] ?? { status: 404 };
    return new Response(route.body ?? null, { status: route.status, headers: route.location ? { location: route.location } : {} });
  };
}
const page = (text: string) => `<html><head><title>Careers</title></head><body><main>${text} ${"Acme builds and services commercial HVAC systems across the region. ".repeat(5)}</main></body></html>`;

test("normalizeUrl ignores www, scheme, tracking params, the hash and a trailing slash", () => {
  assert.equal(normalizeUrl("https://www.Acme.com/careers/dispatcher/?utm_source=x&utm_medium=y#apply"), "acme.com/careers/dispatcher");
  assert.equal(normalizeUrl("http://acme.com/careers/dispatcher"), "acme.com/careers/dispatcher");
  assert.equal(normalizeUrl("https://www.indeed.com/viewjob?jk=abc&from=serp"), "indeed.com/viewjob?jk=abc");
  assert.notEqual(normalizeUrl("https://www.indeed.com/viewjob?jk=abc"), normalizeUrl("https://www.indeed.com/viewjob?jk=def"));
});

test("job boards include ATS hosts, and LinkedIn only under /jobs", () => {
  assert.ok(isJobBoardUrl("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/123"));
  assert.ok(isJobBoardUrl("https://www.linkedin.com/jobs/view/123"));
  assert.ok(!isJobBoardUrl("https://www.linkedin.com/in/someone"));
  assert.ok(!isJobBoardUrl("https://notindeed.com/job"));
});

test("private, loopback and link-local addresses are recognized", () => {
  for (const address of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.4.2", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateAddress(address), address);
  for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.ok(!isPrivateAddress(address), address);
});

test("(a) made-up links, nothing seen and every page missing: everything is dropped and the score is 0", async () => {
  const evidence = aiFitEvidence.parse({ ...empty,
    hiring: [{ title: "Dispatcher", url: "https://acme.com/careers/dispatcher-123", postedDate: "2026-09-20" }],
    change: [{ kind: "acquisition", fact: "Acquired Smith Plumbing in August 2026", date: "2026-08-15", url: "https://news.example.org/acme-buys-smith" }],
    systems: [{ name: "ServiceTitan", url: "https://servicetitan.com/customers/acme" }],
    scale: { locations: 6, url: "https://acme.com/locations" },
  });
  const grounded = await groundEvidence(evidence, { seen: [], domain, fetcher: stubFetcher({}), lookup: publicLookup, now });
  assert.deepEqual(grounded.counts, { seen: 0, confirmed: 0, unverified: 0, dropped: 4 });
  assert.equal(grounded.limitations.length, 4);
  assert.equal(aiFitScore(grounded.evidence, { domain, now }).score, 0);
});

test("(b) a seen item keeps full credit and takes the result's page_age as its date", async () => {
  const evidence = aiFitEvidence.parse({ ...empty, hiring: [{ title: "Dispatcher", url: "https://acme.com/careers/dispatcher", postedDate: null }] });
  const calls: string[] = [];
  const grounded = await groundEvidence(evidence, { seen: [{ url: "https://acme.com/careers/dispatcher", title: "Dispatcher", page_age: "September 20, 2026" }], domain, fetcher: stubFetcher({}, calls), lookup: publicLookup, now });
  assert.equal(grounded.evidence.hiring[0].grounding, "seen");
  assert.equal(grounded.evidence.hiring[0].postedDate, "2026-09-20");
  assert.equal(calls.length, 0, "a seen item needs no page check");
  assert.equal(aiFitScore(grounded.evidence, { domain, now }).breakdown.hiring, 12, "dated and fresh earns full points");
});

test("(c) a company link that redirects to its Workday posting with the title is confirmed", async () => {
  const fetcher = stubFetcher({
    "https://acme.com/careers/billing": { status: 302, location: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Billing-Coordinator_R123" },
    "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Billing-Coordinator_R123": { status: 200, body: page("<h1>Billing Coordinator</h1> Apply now.") },
  });
  const evidence = aiFitEvidence.parse({ ...empty, hiring: [{ title: "Billing Coordinator", url: "https://acme.com/careers/billing", postedDate: "2026-09-25" }] });
  const grounded = await groundEvidence(evidence, { seen: [], domain, fetcher, lookup: publicLookup, now });
  assert.equal(grounded.evidence.hiring[0].grounding, "confirmed");
  assert.equal(aiFitScore(grounded.evidence, { domain, now }).breakdown.hiring, 12);
});

test("(d) a blocked page leaves the item unverified, worth nothing, and noted", async () => {
  const evidence = aiFitEvidence.parse({ ...empty, systems: [{ name: "NetSuite", url: "https://acme.com/about/technology" }] });
  const grounded = await groundEvidence(evidence, { seen: [], domain, fetcher: stubFetcher({ "https://acme.com/about/technology": { status: 403 } }), lookup: publicLookup, now });
  assert.equal(grounded.evidence.systems[0].grounding, "unverified");
  assert.match(grounded.limitations[0], /could not confirm/);
  const fit = aiFitScore(grounded.evidence, { domain, now });
  assert.equal(fit.breakdown.systems, 0);
  assert.equal(fit.unverified, 1);
});

test("(e) a host resolving to a private address is refused without fetching", async () => {
  for (const address of ["10.0.0.1", "127.0.0.1"]) {
    const calls: string[] = [];
    const result = await safeFetch("https://internal.acme.com/jobs", stubFetcher({}, calls), { lookup: async () => [address] });
    assert.equal(result.kind, "refused");
    assert.equal(calls.length, 0);
  }
  const calls: string[] = [];
  assert.equal((await safeFetch("https://10.0.0.1/jobs", stubFetcher({}, calls), { lookup: publicLookup })).kind, "refused");
  assert.equal((await safeFetch("http://acme.com/jobs", stubFetcher({}, calls), { lookup: publicLookup })).kind, "refused");
  assert.equal((await safeFetch("https://localhost/jobs", stubFetcher({}, calls), { lookup: publicLookup })).kind, "refused");
  assert.equal(calls.length, 0);
});

test("a redirect to a private host is refused at that hop", async () => {
  const calls: string[] = [];
  const lookup: Lookup = async (host) => (host === "metadata.acme.com" ? ["169.254.169.254"] : ["93.184.216.34"]);
  const result = await safeFetch("https://acme.com/go", stubFetcher({ "https://acme.com/go": { status: 301, location: "https://metadata.acme.com/latest" } }, calls), { lookup });
  assert.equal(result.kind, "refused");
  assert.deepEqual(calls, ["https://acme.com/go"]);
});

test("redirects stop after three hops and reads stop at the size cap", async () => {
  const loop = stubFetcher({ "https://acme.com/a": { status: 302, location: "/a" } });
  assert.equal((await safeFetch("https://acme.com/a", loop, { lookup: publicLookup })).kind, "failed");
  const big = stubFetcher({ "https://acme.com/big": { status: 200, body: "x".repeat(1_000_000) } });
  const result = await safeFetch("https://acme.com/big", big, { lookup: publicLookup, maxBytes: 300_000 });
  assert.equal(result.kind === "page" && result.html.length, 300_000);
});

test("(f) a seen link matches when it differs only by www, utm params or a trailing slash", async () => {
  const evidence = aiFitEvidence.parse({ ...empty, systems: [{ name: "ServiceTitan", url: "https://www.servicetitan.com/customers/acme/" }] });
  const grounded = await groundEvidence(evidence, { seen: ["https://servicetitan.com/customers/acme?utm_source=google"], domain, fetcher: stubFetcher({}), lookup: publicLookup, now });
  assert.equal(grounded.evidence.systems[0].grounding, "seen");
});

test("a closed posting, a page that says something else, or a redirect elsewhere is dropped", async () => {
  const fetcher = stubFetcher({
    "https://acme.com/jobs/1": { status: 200, body: page("Dispatcher. This position has been filled.") },
    "https://acme.com/jobs/2": { status: 200, body: page("Warehouse Associate") },
    "https://acme.com/jobs/3": { status: 302, location: "https://spam.example.net/landing" },
  });
  const evidence = aiFitEvidence.parse({ ...empty, hiring: [1, 2, 3].map((index) => ({ title: "Dispatcher", url: `https://acme.com/jobs/${index}`, postedDate: null })) });
  const grounded = await groundEvidence(evidence, { seen: [], domain, fetcher, lookup: publicLookup, now });
  assert.deepEqual(grounded.evidence.hiring.map((item) => item.grounding), ["dropped", "dropped", "dropped"]);
});

test("a script-rendered page with no text is unverified, and a page check that runs past the deadline is too", async () => {
  const slow: Fetcher = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const evidence = aiFitEvidence.parse({ ...empty, hiring: [{ title: "Dispatcher", url: "https://acme.com/jobs/9", postedDate: null }] });
  const timedOut = await groundEvidence(evidence, { seen: [], domain, fetcher: slow, lookup: publicLookup, deadlineMs: 20, now });
  assert.equal(timedOut.evidence.hiring[0].grounding, "unverified");
  const empty200 = await groundEvidence(evidence, { seen: [], domain, fetcher: stubFetcher({ "https://acme.com/jobs/9": { status: 200, body: "<html><body><div id=root></div><script>app()</script></body></html>" } }), lookup: publicLookup, now });
  assert.equal(empty200.evidence.hiring[0].grounding, "unverified");
});

test("change facts and scale numbers are confirmed from the page text", async () => {
  const fetcher = stubFetcher({
    "https://news.example.org/acme": { status: 200, body: page("Acme completed its acquisition of Smith Plumbing, expanding into Ohio.") },
    "https://acme.com/locations": { status: 200, body: page("Visit any of our 12 locations.") },
  });
  const evidence = aiFitEvidence.parse({ ...empty,
    change: [{ kind: "acquisition", fact: "Acquired Smith Plumbing to expand into Ohio", date: "2026-09-01", url: "https://news.example.org/acme" }],
    scale: { locations: 12, url: "https://acme.com/locations" },
  });
  const grounded = await groundEvidence(evidence, { seen: [], domain, fetcher, lookup: publicLookup, now });
  assert.equal(grounded.evidence.change[0].grounding, "confirmed");
  assert.equal(grounded.evidence.scale?.grounding, "confirmed");
});

test("the sourcing page counts as seen", async () => {
  const evidence = aiFitEvidence.parse({ ...empty, scale: { locations: 4, url: "https://www.rankings.example.org/top-100" } });
  const grounded = await groundEvidence(evidence, { seen: [], domain, sourceUrl: "https://rankings.example.org/top-100/", fetcher: stubFetcher({}), lookup: publicLookup, now });
  assert.equal(grounded.evidence.scale?.grounding, "seen");
});

test("page_age reads ISO dates, written dates and relative ages", () => {
  assert.equal(pageAgeDate("2026-09-02T10:00:00Z", now), "2026-09-02");
  assert.equal(pageAgeDate("September 2, 2026", now), "2026-09-02");
  assert.equal(pageAgeDate("3 days ago", now), "2026-09-28");
  assert.equal(pageAgeDate("recently", now), null);
});
