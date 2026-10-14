import test from "node:test";
import assert from "node:assert/strict";
import { companyLinks, companyPageItems, assessCompanySignal } from "./company-signals.ts";
import { itemId } from "./identity.ts";
import { companyPriorities } from "./priorities.ts";
import { opportunity } from "./fixtures.ts";
import type { SourceConfig } from "./domain.ts";
const now = Date.parse("2026-10-14T12:00:00Z");
const source: SourceConfig = { id: "site_acme", provider: "company_site", label: "Acme", company: "Acme", domain: "acme.com", value: "https://acme.com/", enabled: true, permission_reference: "Public company research" };
test("company links remain on the recorded public company domain", () => {
  const links = companyLinks('<a href="/news/new-branch">News</a><a href="https://evil.test/news">News</a><a href="javascript:alert(1)">Careers</a><a href="https://user:pass@acme.com/team">Team</a>', source.value, source.domain);
  assert.deepEqual(links, ["https://acme.com/news/new-branch"]);
});
test("publication dates come from article metadata, not website dates or crawl time", () => {
  const body = '<p>Acme opened a new office in Richmond to serve our growing customer base.</p><p>Acme acquired Example Company and welcomed its operations team.</p>';
  const rows = companyPageItems(`<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-13"}</script>${body}`, "https://acme.com/news", source, now);
  assert.equal(rows.length, 2); assert.equal(rows[0].published_at, "2026-10-13T00:00:00.000Z"); assert.notEqual(itemId(rows[0]), itemId(rows[1]));
  const undated = companyPageItems(`<script type="application/ld+json">{"@type":"WebSite","datePublished":"2026-10-13"}</script>${body}`, source.value, source, now);
  assert.equal(undated[0].published_at, null); assert.equal(assessCompanySignal(undated[0])?.confidence, 0.55);
});
test("navigation and script text cannot manufacture a signal", () => {
  const rows = companyPageItems('<nav><p>We are hiring experienced operations managers at our new office.</p></nav><script>Acme acquired Example Company and opened a new office.</script><p>We provide friendly, reliable service to our customers every day.</p>', source.value, source, now);
  assert.equal(rows.length, 0);
});
test("old company timelines and generic acquired-company marketing do not become new signals", () => {
  const rows = companyPageItems('<p>2019 Brian Example promoted to CEO role and company opened a new office.</p><p>The clients of our acquired companies benefit from our excellent customer service.</p>', source.value, source, now);
  assert.equal(rows.length, 0);
});
test("expired jobs and mismatched hiring organizations are not actionable", () => {
  const html = '<script type="application/ld+json">{"@type":"JobPosting","title":"Operations Coordinator","description":"Manage dispatch and daily customer handoffs.","datePosted":"2026-10-01","validThrough":"2026-10-10","hiringOrganization":{"name":"Acme"}}</script>';
  const job = companyPageItems(html, source.value, source, now)[0]; assert.equal(job.active, false); assert.equal(assessCompanySignal(job), null);
  assert.equal(companyPageItems(html.replace('"name":"Acme"', '"name":"Other Company"'), source.value, source, now).length, 0);
});
test("compound ranking deduplicates repeated evidence and does not turn undated context into urgency", () => {
  const text = '<p>Acme opened a new office in Richmond to serve our growing customer base.</p>';
  const item = companyPageItems(text, source.value, source, now)[0];
  const row = opportunity({ company_confirmed: true, company_domain: "acme.com", item, assessment: assessCompanySignal(item), checked_at: new Date(now).toISOString() });
  const groups = companyPriorities([row, { ...row, id: "duplicate", item: { ...item, url: "https://acme.com/about" } }], now);
  assert.equal(groups[0].signals.length, 1); assert.equal(groups[0].urgency, 0); assert.equal(groups[0].label, "Background context");
});
