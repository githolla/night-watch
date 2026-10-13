import test from "node:test";
import assert from "node:assert/strict";
import { loadPortfolio } from "./portfolio.ts";
import { queryDb } from "../testing/query-db.ts";
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
