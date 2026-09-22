/**
 * Write the reach-out cut to a spreadsheet: one row per company Nine-67 is actually writing to, with the
 * target titles and the signal behind each.
 *
 * The opposite direction from export-target-cut.py, which flattens the source workbook. This exports what
 * the app has DECIDED — the tier rules and the competitor cut applied — so the list you work from and the
 * list the worklist works from cannot drift apart.
 *
 *   node --experimental-strip-types scripts/export-sales-list.ts [path.csv]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { targetAccounts } from "../src/lib/target-accounts.ts";

const COLUMNS = ["tier", "name", "domain", "vertical", "subSegment", "revenueBand", "employees", "hqCity", "hqState", "ownership", "peSponsor", "ceo", "targetTitles", "aiSignal", "notes", "sourceUrl"] as const;

/** A field safe to sit in a CSV cell: quoted when it carries a comma, a quote or a newline. */
function cell(value: unknown): string {
  const text = Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const rows = targetAccounts
  .filter((account) => account.outreach)
  .sort((a, b) => a.tier.localeCompare(b.tier) || a.vertical.localeCompare(b.vertical) || a.name.localeCompare(b.name));

const output = process.argv[2] ?? join(process.cwd(), "nine67-sales-list.csv");
writeFileSync(output, [COLUMNS.join(","), ...rows.map((row) => COLUMNS.map((column) => cell((row as unknown as Record<string, unknown>)[column])).join(","))].join("\n"));

const tally = (key: (account: (typeof rows)[number]) => string) => {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
};
console.log(`${rows.length} companies on the reach-out list → ${output}`);
console.log(`by tier: ${tally((row) => row.tier).map(([tier, n]) => `${tier} ${n}`).join(", ")}`);
console.log(`by vertical: ${tally((row) => row.vertical).map(([vertical, n]) => `${vertical} ${n}`).join(", ")}`);
