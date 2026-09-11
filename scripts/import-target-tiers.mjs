import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// The reach-out cut: every company on the master list, with its tier.
// Produced from data/Nine67_Outbound_Targets_Cut.xlsx by scripts/export-target-cut.py.
const sourcePath = resolve("data/Nine67_Outbound_Targets_Cut.csv");
const outputPath = resolve("src/lib/target-tiers.generated.ts");
const expectedColumns = ["tier", "company", "website", "drop_reason"];
const tiers = new Set(["A1", "A2", "B", "C", "removed"]);

function parseCsv(input) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

const [headers, ...records] = parseCsv(readFileSync(sourcePath, "utf8").replace(/^﻿/, ""));
if (JSON.stringify(headers) !== JSON.stringify(expectedColumns)) throw new Error(`Unexpected CSV columns: ${headers.join(", ")}`);

const websites = new Set();
const rows = records.filter((record) => record.some(Boolean)).map((record, index) => {
  if (record.length !== expectedColumns.length) throw new Error(`Row ${index + 2} has ${record.length} columns`);
  const [tier, company, website, dropReason] = record.map((value) => value.trim());
  if (!tiers.has(tier)) throw new Error(`Row ${index + 2}: unknown tier ${tier}`);
  if (!company || !website) throw new Error(`Row ${index + 2} is missing the company or website`);
  if (websites.has(website)) throw new Error(`Duplicate website on row ${index + 2}: ${website}`);
  websites.add(website);
  return [website, tier, dropReason];
});

const output = `// Generated from data/Nine67_Outbound_Targets_Cut.csv. Run npm run targets:generate after replacing the workbook.\n\nexport type TargetTier = "A1" | "A2" | "B" | "C" | "removed";\n\nexport const targetTierData: ReadonlyArray<readonly [website: string, tier: TargetTier, dropReason: string]> = [\n${rows.map((row) => `  ${JSON.stringify(row)},`).join("\n")}\n];\n`;
writeFileSync(outputPath, output);
console.log(`${rows.length} tiers written to src/lib/target-tiers.generated.ts`);
