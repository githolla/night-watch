import assert from "node:assert/strict";
import test from "node:test";
import type { Fetcher } from "./ats.ts";
import { jsonLdPostings, sitemapPostings, titleFromSlug } from "./discover.ts";

function fakeFetch(routes: Record<string, string>): Fetcher {
  return async (url) => {
    const key = Object.keys(routes).filter((prefix) => url.startsWith(prefix)).sort((a, b) => b.length - a.length)[0];
    if (!key) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => routes[key] };
  };
}

test("reads JobPosting structured data, including graphs and item lists", () => {
  const html = `
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"Organization","name":"Acme"},
      {"@type":"JobPosting","title":"Revenue Operations Analyst","url":"/jobs/revops-analyst-42","datePosted":"2026-09-02T00:00:00Z","baseSalary":{"@type":"MonetaryAmount","value":{"@type":"QuantitativeValue","maxValue":98000}},"jobLocation":{"@type":"Place","address":{"addressLocality":"Denver","addressRegion":"CO"}},"description":"<p>Own the pipeline data.</p>"}
    ]}</script>
    <script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"ListItem","item":{"@type":"JobPosting","name":"Support Specialist","url":"https://acme.com/jobs/support-1"}}]}</script>
    <script type="application/ld+json">not json</script>`;
  const postings = jsonLdPostings(html, "https://acme.com/careers");
  assert.deepEqual(postings.map((p) => [p.title, p.url, p.postedAt, p.salaryMax, p.location]), [
    ["Revenue Operations Analyst", "https://acme.com/jobs/revops-analyst-42", "2026-09-02", 98000, "Denver, CO"],
    ["Support Specialist", "https://acme.com/jobs/support-1", null, null, null],
  ]);
  assert.equal(postings[0].description, "Own the pipeline data.");
});

test("derives a title from a job URL slug", () => {
  assert.equal(titleFromSlug("https://acme.com/careers/senior-data-analyst-r123456"), "Senior Data Analyst");
  assert.equal(titleFromSlug("https://jobs.acme.com/job/12345/customer_support_specialist"), "Customer Support Specialist");
  assert.equal(titleFromSlug("https://acme.com/jobs/Chicago-IL/Sales-Development-Representative/1234"), "Sales Development Representative");
  assert.equal(titleFromSlug("https://acme.com/about-us"), null);
  assert.equal(titleFromSlug("https://acme.com/careers/"), null);
});

test("collects job URLs from a sitemap index", async () => {
  const fetcher = fakeFetch({
    "https://www.acme.com/sitemap.xml": `<sitemapindex><sitemap><loc>https://www.acme.com/sitemap-pages.xml</loc></sitemap><sitemap><loc>https://www.acme.com/sitemap-jobs.xml</loc></sitemap></sitemapindex>`,
    "https://www.acme.com/sitemap-jobs.xml": `<urlset><url><loc>https://www.acme.com/careers/jobs/business-systems-analyst-3321</loc></url><url><loc>https://www.acme.com/careers/jobs/cdl-driver-100</loc></url><url><loc>https://www.acme.com/careers</loc></url></urlset>`,
    "https://www.acme.com/sitemap-pages.xml": `<urlset><url><loc>https://www.acme.com/about</loc></url></urlset>`,
  });
  const postings = await sitemapPostings(fetcher, ["www.acme.com"]);
  assert.deepEqual(postings.map((p) => p.title), ["Business Systems Analyst", "Cdl Driver"]);
});
