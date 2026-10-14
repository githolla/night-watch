import test from "node:test";
import assert from "node:assert/strict";
import { loadPortfolio } from "./portfolio.ts";
import { queryDb } from "../testing/query-db.ts";
import { focusForOwner } from "../focus-data.ts";
import { records } from "./fixtures.ts";
import { researchData, setNightlyLists } from "../research-data/server.ts";
test("portfolio uses sourced researched revenue and preserves unconfirmed candidate values", async () => {
  const h = queryDb({ accounts: [{ ...records.companies[0], domain: "ansararestaurantgroup.com" }, { ...records.companies[0], id: "other", domain: "other.com", vertical: null }], list_candidates: [{ id: "candidate", domain: "other.com", sector: "Retail", revenue_usd_m: 450, revenue_year: 2024, source_url: "https://other.com/report" }] });
  const portfolio = await loadPortfolio(h.db);
  const company = portfolio.companies.find((company) => company.domain === "ansararestaurantgroup.com")!;
  assert.equal(company.revenueUsdM, 93.5); assert.equal(company.revenueStatus, "reported");
  const candidate = portfolio.companies.find((company) => company.domain === "other.com")!;
  assert.equal(candidate.revenueUsdM, 450); assert.equal(candidate.revenueStatus, "unconfirmed"); assert.equal(candidate.vertical, "Retail");
  assert.ok(portfolio.graph.nodes.find((node) => node.id === "company:other")?.facts.some((fact) => fact.label === "Revenue" && fact.value.includes("unconfirmed")));
  const rationale = portfolio.graph.nodes.find(node => node.label === "Why this company was selected");
  assert.ok(rationale?.detail);
  assert.ok(rationale?.facts.some(item => item.label === "Added to list" && item.value === "Exact timestamp not recorded"));
  assert.ok(portfolio.graph.edges.some(edge => edge.to === rationale?.id && edge.label === "selected using this research"));
  assert.ok(portfolio.graph.nodes.some(node => node.kind === "source" && node.sourceUrl));
  assert.ok(h.log.every((entry) => entry.op === "select"));
});
test("employee-based sizing never becomes reported revenue in the portfolio", async () => {
  const row = { ...researchData().batch3Focus[0], domain: "employee-sized.com", revenue: { ...researchData().batch3Focus[0].revenue, status: "estimated", employees: 240 } };
  setNightlyLists({ nightlyFocus: [row], nightlyOffers: [], nightlyLatest: { josh: [], suuchi: [] } });
  try {
    const portfolio = await loadPortfolio(queryDb({ accounts: [{ ...records.companies[0], domain: row.domain }] }).db);
    assert.equal(portfolio.companies[0].revenueUsdM, null);
    assert.equal(portfolio.companies[0].employee_range, "~240");
  } finally { setNightlyLists({ nightlyFocus: [], nightlyOffers: [], nightlyLatest: { josh: [], suuchi: [] } }); }
});

test("initial overview never loads relationship tables or serializes research bodies", async () => {
  const companies = Array.from({ length: 2002 }, (_, index) => ({ ...records.companies[0], id: `co-${index}`, domain: `company-${index}.com` }));
  const h = queryDb({ accounts: companies, job_postings: Array.from({ length: 4000 }, (_, index) => ({ ...records.jobs[0], id: `job-${index}`, account_id: companies[index % companies.length].id })) });
  const portfolio = await loadPortfolio(h.db, { overview: true });
  assert.equal(portfolio.companies.length, 2002); assert.equal(portfolio.graph.nodes.length, 2002);
  assert.ok(portfolio.graph.nodes.every((node) => node.kind === "company"));
  assert.ok(h.log.every((entry) => !["people", "cards", "touches", "signals", "job_postings", "public_posts", "discovery_opportunities"].includes(entry.table)));
  assert.ok(JSON.stringify(portfolio).length < 3_000_000);
});

test("full target-list graph reads only list companies and all their relationships", async () => {
  const row = focusForOwner("josh", 1)[0];
  const h = queryDb({ accounts: [{ ...records.companies[0], domain: row.domain }, { ...records.companies[0], id: "outside", domain: "outside.com" }], people: [...records.people, { ...records.people[0], id: "outside-person", account_id: "outside" }], cards: records.drafts, touches: records.touches, signals: records.signals, job_postings: [...records.jobs, { ...records.jobs[0], id: "outside-job", account_id: "outside" }], public_posts: records.posts, discovery_opportunities: records.discoveries });
  const portfolio = await loadPortfolio(h.db, { owner: "josh" });
  assert.equal(portfolio.companies.length, 1);
  assert.ok(portfolio.graph.nodes.some((node) => node.kind === "person"));
  assert.ok(portfolio.graph.nodes.some((node) => node.kind === "reply"));
  assert.equal(portfolio.graph.nodes.some((node) => node.companyId === "outside"), false);
  assert.equal(portfolio.graph.nodes.filter((node) => node.kind === "job").length, records.jobs.length);
});
