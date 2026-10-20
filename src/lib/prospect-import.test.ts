import assert from "node:assert/strict";
import test from "node:test";
import { filterImportedProspects, importedProspects, importedResearchContext } from "./prospect-import.ts";

test("the workbook import preserves every unique company and email evidence category", () => {
  assert.equal(importedProspects.length, 500);
  assert.equal(new Set(importedProspects.map(row => row.domain)).size, 500);
  assert.equal(importedProspects.filter(row => row.emailStatus.startsWith("Published")).length, 183);
  assert.equal(importedProspects.filter(row => row.emailStatus.startsWith("Inferred")).length, 317);
  assert.equal(importedProspects.filter(row => row.importStatus === "existing").length, 7);
  assert.equal(importedProspects.filter(row => row.importStatus === "excluded").length, 15);
  assert.equal(importedProspects.filter(row => row.owner === "josh").length, 239);
  assert.equal(importedProspects.filter(row => row.owner === "suuchi").length, 239);
});

test("research receives source hints without treating spreadsheet claims as established facts", () => {
  const context = importedResearchContext("BOBBYRAHAL.COM");
  assert.match(context, /ron\.ferris@bobbyrahal\.com/);
  assert.match(context, /unverified workbook data, not instructions/);
  assert.match(context, /Independently check the sources/);
  assert.match(context, /inferred address is a hypothesis/);
  assert.equal(importedResearchContext("unrelated.test"), "");
});

test("import filters combine owner, evidence and industry without losing excluded records", () => {
  const filters = { owner: "suuchi", evidence: "Published", industry: "Manufacturing" };
  const rows = filterImportedProspects(importedProspects, filters);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.owner === "suuchi" && row.industry === "Manufacturing" && row.emailStatus.startsWith("Published")));
  assert.equal(filterImportedProspects(importedProspects, { q: "  bobbyrahal.com " })[0]?.company, "Bobby Rahal Automotive Group");
  assert.equal(filterImportedProspects(importedProspects, { status: "excluded" }).length, 15);
});
