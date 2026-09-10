import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourcePath = resolve("data/Nine67_Outbound_Targets_50M_plus.csv");
const outputPath = resolve("src/lib/target-accounts.generated.ts");
const expectedColumns = [
  "company", "industry", "sub_segment", "hq_city", "hq_state", "website",
  "revenue_estimate_usd_m", "revenue_band", "employees", "ownership", "pe_sponsor",
  "ceo", "likely_buyer_titles", "ai_signal", "source_url", "notes", "also_in",
];

function parseCsv(input) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

const [headers, ...records] = parseCsv(readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, ""));
if (JSON.stringify(headers) !== JSON.stringify(expectedColumns)) {
  throw new Error(`Unexpected CSV columns: ${headers.join(", ")}`);
}

const websites = new Set();
const rows = records.filter((record) => record.some(Boolean)).map((record, index) => {
  if (record.length !== expectedColumns.length) throw new Error(`Row ${index + 2} has ${record.length} columns`);
  const values = Object.fromEntries(expectedColumns.map((column, columnIndex) => [column, record[columnIndex].trim()]));
  if (!values.company || !values.website || !values.industry || !values.revenue_band || !values.source_url) {
    throw new Error(`Row ${index + 2} is missing a required field`);
  }
  const website = values.website.toLowerCase();
  if (websites.has(website)) throw new Error(`Duplicate website on row ${index + 2}: ${website}`);
  websites.add(website);
  const revenue = values.revenue_estimate_usd_m ? Number(values.revenue_estimate_usd_m) : null;
  const employees = values.employees ? Number(values.employees) : null;
  if (revenue !== null && (!Number.isFinite(revenue) || revenue < 50)) throw new Error(`Invalid revenue on row ${index + 2}`);
  if (employees !== null && (!Number.isFinite(employees) || employees < 1)) throw new Error(`Invalid employee count on row ${index + 2}`);
  return [
    values.company, values.industry, values.sub_segment, values.hq_city, values.hq_state,
    website, revenue, values.revenue_band, employees, values.ownership, values.pe_sponsor,
    values.ceo, values.likely_buyer_titles.split(";").map((title) => title.trim()).filter(Boolean),
    values.ai_signal, values.source_url, values.notes, values.also_in,
  ];
});

const output = `// Generated from data/Nine67_Outbound_Targets_50M_plus.csv. Run npm run targets:generate after replacing the CSV.\n\nexport type TargetAccountRecord = readonly [\n  company: string, industry: string, subSegment: string, hqCity: string, hqState: string,\n  website: string, revenueEstimateUsdM: number | null, revenueBand: string, employees: number | null,\n  ownership: string, peSponsor: string, ceo: string, likelyBuyerTitles: string[], aiSignal: string,\n  sourceUrl: string, notes: string, alsoIn: string,\n];\n\nexport const targetAccountData: TargetAccountRecord[] = [\n${rows.map((row) => `  ${JSON.stringify(row)},`).join("\n")}\n];\n`;

writeFileSync(outputPath, output);
console.log(`Generated ${rows.length} target accounts at ${outputPath}`);
