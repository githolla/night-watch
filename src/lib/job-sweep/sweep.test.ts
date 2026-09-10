import assert from "node:assert/strict";
import test from "node:test";
import type { Fetcher } from "./ats.ts";
import { hiringSignal, sweepAccount } from "./sweep.ts";
import type { Account } from "../types.ts";

const account: Account = {
  id: "acct-1", name: "Anchin", domain: "anchin.com", vertical: "Accounting services", employee_range: "1,000–5,000", target_titles: ["Managing Partner", "COO"],
  linkedin_url: null, careers_url: null, news_query: null, status: "active", last_scouted_at: null, email_pattern: null, pattern_confidence: null,
};

function fakeFetch(routes: Record<string, string | object>): Fetcher {
  return async (url) => {
    const key = Object.keys(routes).filter((prefix) => url.startsWith(prefix)).sort((left, right) => right.length - left.length)[0];
    if (!key) return { ok: false, status: 404, text: async () => "" };
    const body = routes[key];
    return { ok: true, status: 200, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  };
}

test("homepage link → careers page → embedded board → classified postings", async () => {
  const fetcher = fakeFetch({
    "https://www.anchin.com/": '<nav><a href="/about/careers">Careers</a></nav>',
    "https://www.anchin.com/about/careers": '<div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=anchin"></script>',
    "https://boards-api.greenhouse.io/v1/boards/anchin/jobs": { jobs: [
      { id: 1, title: "Data Analyst", absolute_url: "https://boards.greenhouse.io/anchin/jobs/1", first_published: "2026-08-20T00:00:00Z", departments: [{ name: "Operations" }] },
      { id: 2, title: "Client Service Representative", absolute_url: "https://boards.greenhouse.io/anchin/jobs/2", first_published: "2026-09-01T00:00:00Z" },
      { id: 3, title: "Tax Senior Associate", absolute_url: "https://boards.greenhouse.io/anchin/jobs/3", first_published: "2026-09-05T00:00:00Z" },
    ] },
  });
  const result = await sweepAccount(account, fetcher, new Date("2026-09-10T00:00:00Z"));
  assert.equal(result.status, "listings");
  assert.deepEqual(result.ats, { provider: "greenhouse", ref: "anchin" });
  assert.equal(result.postings.length, 3);
  assert.deepEqual(result.targetPostings.map((p) => [p.title, p.family]), [["Data Analyst", "data_analyst"], ["Client Service Representative", "support"]]);

  const signal = await hiringSignal(account, result, [], new Date("2026-09-10T00:00:00Z"));
  assert.ok(signal);
  assert.equal(signal.type, "job_cluster");
  assert.equal(signal.evidence_kind, "hiring");
  assert.equal(signal.observed_at, "2026-09-01");
  assert.equal(signal.job?.days_open, 21);
  assert.match(signal.operating_need, /hiring 2 roles/);
  assert.equal(signal.people[0]?.name, "Russell Shinsky");
  assert.equal(signal.people[0]?.title, "CEO");
});

test("a careers page rendered by script is reported as found, not as a quiet company", async () => {
  const fetcher = fakeFetch({
    "https://www.anchin.com/": "<p>Welcome</p>",
    "https://www.anchin.com/careers": '<div id="app"></div><script src="/bundle.js"></script><h1>Careers</h1>',
  });
  const result = await sweepAccount(account, fetcher);
  assert.equal(result.status, "found");
  assert.equal(result.careersUrl, "https://www.anchin.com/careers");
  assert.match(result.note, /not readable/);
  assert.equal(result.targetPostings.length, 0);
});

test("no careers page anywhere is reported as none", async () => {
  const result = await sweepAccount(account, fakeFetch({ "https://www.anchin.com/": "<p>Welcome</p>" }));
  assert.equal(result.status, "none");
  assert.equal(await hiringSignal(account, result, [], new Date()), null);
});

test("a remembered board is read first without discovery", async () => {
  const fetcher = fakeFetch({ "https://api.lever.co/v0/postings/anchin": [{ id: "x", text: "Revenue Operations Manager", hostedUrl: "https://jobs.lever.co/anchin/x" }] });
  const result = await sweepAccount({ ...account, ats_provider: "lever", ats_ref: "anchin" }, fetcher);
  assert.equal(result.status, "listings");
  assert.equal(result.targetPostings[0].family, "revops");
});
