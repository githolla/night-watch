import assert from "node:assert/strict";
import test from "node:test";
import { careersLinkFromHomepage, detectAts, fetchPostings, postingsFromHtml, relativePostedDate, type Fetcher } from "./ats.ts";

function fakeFetch(routes: Record<string, unknown>): Fetcher {
  return async (url) => {
    const key = Object.keys(routes).filter((prefix) => url.startsWith(prefix)).sort((left, right) => right.length - left.length)[0];
    if (!key) return { ok: false, status: 404, text: async () => "" };
    const body = routes[key];
    return { ok: true, status: 200, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  };
}

test("detects boards embedded in a careers page", () => {
  assert.deepEqual(detectAts('<iframe src="https://boards.greenhouse.io/acmecorp?for=acmecorp">', "https://acme.com/careers"), { provider: "greenhouse", ref: "acmecorp" });
  assert.deepEqual(detectAts('<a href="https://jobs.lever.co/acme-inc">Open roles</a>', "https://acme.com/careers"), { provider: "lever", ref: "acme-inc" });
  assert.deepEqual(detectAts("", "https://acme.wd5.myworkdayjobs.com/en-US/External"), { provider: "workday", ref: "acme|wd5|External" });
  assert.deepEqual(detectAts('<script src="https://acme.bamboohr.com/careers/embed.js">', "https://acme.com/jobs"), { provider: "bamboohr", ref: "acme" });
  assert.deepEqual(detectAts('<a href="https://careers-acme.icims.com/jobs/search">', "https://acme.com"), { provider: "icims", ref: "careers-acme" });
  assert.deepEqual(detectAts('<script src="https://boards.greenhouse.io/embed/job_board/js?for=acmecorp"></script>', "https://acme.com/careers"), { provider: "greenhouse", ref: "acmecorp" });
  assert.equal(detectAts("<p>We are hiring</p>", "https://acme.com/careers"), null);
});

test("reads Greenhouse, Lever and Workday boards into normalized postings", async () => {
  const fetcher = fakeFetch({
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs": { jobs: [{ id: 1, title: "Data Analyst", absolute_url: "https://boards.greenhouse.io/acme/jobs/1", first_published: "2026-09-01T10:00:00Z", location: { name: "Remote" }, departments: [{ name: "Finance" }] }] },
    "https://api.lever.co/v0/postings/acme": [{ id: "a", text: "Salesforce Administrator", hostedUrl: "https://jobs.lever.co/acme/a", createdAt: Date.UTC(2026, 8, 1), categories: { department: "RevOps", location: "Austin" } }],
    "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs": { total: 1, jobPostings: [{ title: "Customer Service Representative", externalPath: "/job/Dallas/CSR_R123", locationsText: "Dallas", postedOn: "Posted 3 Days Ago" }] },
  });
  const now = new Date("2026-09-10T00:00:00Z");
  const greenhouse = await fetchPostings(fetcher, { provider: "greenhouse", ref: "acme" }, now);
  assert.deepEqual(greenhouse.map((p) => [p.title, p.url, p.postedAt, p.department]), [["Data Analyst", "https://boards.greenhouse.io/acme/jobs/1", "2026-09-01", "Finance"]]);
  const lever = await fetchPostings(fetcher, { provider: "lever", ref: "acme" }, now);
  assert.equal(lever[0].title, "Salesforce Administrator");
  assert.equal(lever[0].postedAt, "2026-09-01");
  const workday = await fetchPostings(fetcher, { provider: "workday", ref: "acme|wd5|External" }, now);
  assert.deepEqual(workday.map((p) => [p.title, p.url, p.postedAt]), [["Customer Service Representative", "https://acme.wd5.myworkdayjobs.com/External/job/Dallas/CSR_R123", "2026-09-07"]]);
});

test("an unreachable board yields no postings rather than an exception", async () => {
  const postings = await fetchPostings(fakeFetch({}), { provider: "ashby", ref: "nobody" });
  assert.deepEqual(postings, []);
});

test("relative Workday dates resolve against now", () => {
  const now = new Date("2026-09-10T00:00:00Z");
  assert.equal(relativePostedDate("Posted Today", now), "2026-09-10");
  assert.equal(relativePostedDate("Posted Yesterday", now), "2026-09-09");
  assert.equal(relativePostedDate("Posted 30+ Days Ago", now), "2026-08-11");
  assert.equal(relativePostedDate("Full time", now), null);
});

test("generic careers HTML yields job-looking links only", () => {
  const html = `
    <a href="/careers/openings/data-analyst-1234">Data Analyst</a>
    <a href="/careers/openings/data-analyst-1234">Apply</a>
    <a href="/about">About us</a>
    <a href="https://acme.com/jobs/ops-coordinator">Operations Coordinator</a>
    <a href="/careers">Careers</a>`;
  const postings = postingsFromHtml(html, "https://acme.com/careers");
  assert.deepEqual(postings.map((p) => [p.title, p.url]), [
    ["Data Analyst", "https://acme.com/careers/openings/data-analyst-1234"],
    ["Operations Coordinator", "https://acme.com/jobs/ops-coordinator"],
  ]);
});

test("finds the careers link on a homepage", () => {
  assert.equal(careersLinkFromHomepage('<nav><a href="/about">About</a><a href="/company/join-our-team">Join our team</a></nav>', "https://acme.com/"), "https://acme.com/company/join-our-team");
  assert.equal(careersLinkFromHomepage('<a href="/contact">Contact</a>', "https://acme.com/"), null);
});

test("detects and reads UKG, Oracle HCM and Rippling boards", async () => {
  assert.deepEqual(detectAts('<a href="https://recruiting.ultipro.com/ACM1000ACME/JobBoard/abc-123/">Apply</a>', "https://acme.com/careers"), { provider: "ukg", ref: "recruiting.ultipro.com|ACM1000ACME|abc-123" });
  assert.deepEqual(detectAts("", "https://efgh.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions"), { provider: "oracle", ref: "efgh.fa.us2.oraclecloud.com|CX_1" });
  assert.deepEqual(detectAts('<iframe src="https://ats.rippling.com/acme/jobs">', "https://acme.com/jobs"), { provider: "rippling", ref: "acme" });
  const fetcher = fakeFetch({
    "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/abc-123/JobBoardView/LoadSearchResults": { opportunities: [{ Id: "r1", Title: "Business Systems Analyst", PostedDate: "2026-09-03T00:00:00Z", Locations: [{ LocalizedName: "Tampa, FL" }] }], totalCount: 1 },
    "https://efgh.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions": { items: [{ requisitionList: [{ Id: "300001", Title: "Customer Support Specialist", PostedDate: "2026-09-04", PrimaryLocation: "Phoenix, AZ" }] }] },
    "https://api.rippling.com/platform/api/ats/v1/board/acme/jobs": [{ uuid: "u1", name: "Sales Development Representative", url: "https://ats.rippling.com/acme/jobs/u1", department: { name: "Sales" }, workLocation: { label: "Remote" } }],
  });
  const ukg = await fetchPostings(fetcher, { provider: "ukg", ref: "recruiting.ultipro.com|ACM1000ACME|abc-123" });
  assert.deepEqual(ukg.map((p) => [p.title, p.postedAt, p.location]), [["Business Systems Analyst", "2026-09-03", "Tampa, FL"]]);
  const oracle = await fetchPostings(fetcher, { provider: "oracle", ref: "efgh.fa.us2.oraclecloud.com|CX_1" });
  assert.deepEqual(oracle.map((p) => [p.title, p.url]), [["Customer Support Specialist", "https://efgh.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/300001"]]);
  const rippling = await fetchPostings(fetcher, { provider: "rippling", ref: "acme" });
  assert.deepEqual(rippling.map((p) => [p.title, p.department, p.location]), [["Sales Development Representative", "Sales", "Remote"]]);
});
