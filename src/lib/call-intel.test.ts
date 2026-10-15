import test from "node:test";
import assert from "node:assert/strict";
import profiles from "../../data/call-company-profiles.json" with { type: "json" };
import { buildCompanyIntel } from "./call-intel.ts";

test("manufacturer prep names actual products and asks about the manufacturing workflow", () => {
  const intel = buildCompanyIntel({ domain: "taylordevices.com", title: "CEO" });
  assert.equal(intel.productHeading, "What they manufacture");
  assert.ok(intel.products.includes("Fluid viscous dampers"));
  assert.match(intel.questions[0], /damper specification/);
  assert.match(intel.operations ?? "", /quality standards/);
  assert.equal(intel.sourceUrl, "https://www.taylordevices.com/products/fluid-viscous-dampers/");
});

test("different business models get specific products and questions", () => {
  const nursery = buildCompanyIntel({ domain: "cherrylake.com", title: "CEO" });
  assert.equal(nursery.productHeading, "What they grow & deliver");
  assert.match(nursery.questions[0], /truck loading/);
  const restaurant = buildCompanyIntel({ domain: "dortchenterprises.com", title: "President" });
  assert.match(restaurant.overview ?? "", /Taco Bell/);
  assert.match(restaurant.questions[0], /restaurant exceptions/);
  const service = buildCompanyIntel({ domain: "brubakerinc.com", title: "CEO" });
  assert.ok(service.products.includes("Heating and cooling"));
  assert.match(service.questions[0], /plumbing, HVAC and electrical/);
});

test("sourced research is grouped while unsupported facts are excluded", () => {
  const intel = buildCompanyIntel({ domain: "unknown.test", title: "COO", sector: "Industrial distribution", row: { aiFit: { reasons: [{ criterion: "systems", points: 8, text: "Uses an ERP", url: "https://example.test/case" }, { criterion: "scale", points: 10, text: "100 branches", url: null }, { criterion: "change", points: 0, text: "New owner", url: "javascript:alert(1)" }] } } });
  assert.equal(intel.productHeading, "What they distribute");
  assert.equal(intel.overview, null);
  assert.equal(intel.evidence.length, 1);
  assert.equal(intel.evidence[0].title, "Systems already in place");
  assert.ok(intel.gaps.some(gap => gap.includes("products")));
  assert.match(intel.roleAngle, /cross-team handoffs/);
});

test("dossier fallback preserves sourced facts and their original dates", () => {
  const intel = buildCompanyIntel({ domain: "unknown.test", title: "CEO", dossier: { brief: { company_profile: { what_they_do: "Makes industrial filters" }, verification: { checked_on: "2026-09-01" } }, dossier: { facts: [{ statement: "Opened a facility", source_url: "https://example.test/news", published_date: "2024-01-01" }] } } });
  assert.equal(intel.overview, "Makes industrial filters");
  assert.equal(intel.evidence[0].facts[0].date, "2024-01-01");
});

test("all 36 researched call-company profiles have specific offerings and source provenance", () => {
  assert.equal(profiles.length, 36);
  assert.equal(new Set(profiles.map(profile => profile.domain)).size, profiles.length);
  for (const profile of profiles) {
    assert.ok(profile.overview.length > 20, profile.domain);
    assert.ok(profile.products.length > 0, profile.domain);
    assert.ok(profile.sourceUrl.startsWith("https://"), profile.domain);
    assert.match(profile.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(profile.question.endsWith("?"), profile.domain);
  }
});


test("new researched company profiles flow into prep without an industry guess becoming a fact", () => {
  const intel = buildCompanyIntel({ domain: "newfactory.test", title: "COO", sector: "Manufacturing", row: { businessProfile: { overview: "Makes stainless steel process vessels", products: ["Mixing tanks"], customers: [], operations: "", sourceUrl: "https://newfactory.test/products", checkedAt: "2026-10-15" }, aiFit: { reasons: [{ criterion: "systems", points: 0, text: "Not counted: ERP", url: "https://example.test" }] } } });
  assert.equal(intel.overview, "Makes stainless steel process vessels");
  assert.deepEqual(intel.products, ["Mixing tanks"]);
  assert.equal(intel.productHeading, "What they manufacture");
  assert.equal(intel.evidence.length, 0);
  assert.ok(intel.gaps.some(gap => gap.includes("Installed")));
});

test("every company has four distinct question cards with deeper follow-ups and a clear goal", () => {
  for (const domain of [...profiles.map(profile => profile.domain), "unknown.test"]) {
    const intel = buildCompanyIntel({ domain, title: "COO" });
    assert.equal(intel.questionCards.length, 4, domain);
    assert.equal(new Set(intel.questionCards.map(card => card.ask)).size, 4, domain);
    for (const card of intel.questionCards) {
      assert.ok(card.ask.endsWith("?"), domain);
      assert.equal(card.followups.length, 3, domain);
      assert.ok(card.listenFor.length > 0, domain);
      assert.ok(card.goal.length > 20, domain);
    }
  }
});

test("deeper tool questions reference only sourced installed-system evidence", () => {
  const intel = buildCompanyIntel({ domain: "unknown.test", title: "CEO", row: { aiFit: { reasons: [{ criterion: "systems", points: 8, text: "Runs on Aspire", url: "https://example.test/case" }, { criterion: "systems", points: 0, text: "Unconfirmed ERP", url: "https://example.test/other" }] } } });
  assert.deepEqual(intel.questionCards[2].context, [{ text: "Runs on Aspire", url: "https://example.test/case" }]);
  assert.match(intel.questionCards[2].followups[0], /already handled well/);
});
