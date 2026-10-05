// Load a reach-out list researched outside the app (no Anthropic calls) into the database.
//
//   pnpm list:check acme.com other.com      which domains a list can still use
//   pnpm list:import tonight.json           research JSON -> a seat's list, cards prepared
//
// Reads NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
// from .env.local, plus HUNTER_API_KEY for the address check when set. The JSON is one import or an array:
//   { "listDate": "2026-10-05", "owner": "suuchi", "companies": [ { "company", "domain", "sector",
//     "revenueUsdM", "revenueYear", "sourceUrl", "research": { ...the shape researchPrompt asks for } } ] }
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { importResearchedList, screenDomains, type ResearchedCompany } from "../src/lib/nightly-list-builder.ts";
import { seatOwner } from "../src/lib/types.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
const db = createClient(url, key, { auth: { persistSession: false } });
const [command, ...rest] = process.argv.slice(2);

if (command === "check") {
  for (const row of await screenDomains(db, rest)) console.log(`${row.usable ? "ok  " : "skip"} ${row.domain}${row.reason ? `  (${row.reason})` : ""}`);
} else if (command === "import") {
  const parsed = JSON.parse(readFileSync(rest[0], "utf8")) as unknown;
  const imports = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ listDate: string; owner: string; companies: ResearchedCompany[] }>;
  for (const item of imports) {
    const owner = seatOwner(item.owner);
    if (!owner || !/^\d{4}-\d{2}-\d{2}$/.test(item.listDate ?? "")) throw new Error(`Each import needs an owner (josh or suuchi) and a listDate (YYYY-MM-DD); got ${item.owner} ${item.listDate}.`);
    const result = await importResearchedList(db, { listDate: item.listDate, owner, companies: item.companies ?? [] });
    console.log(`\n${owner} ${result.listDate}: list ${result.status}, ${result.listed.length} added`);
    for (const row of result.listed) console.log(`  + ${row.company} (${row.domain}) fit ${row.fit}`);
    for (const domain of result.reserved) console.log(`  ~ ${domain} kept as a reserve`);
    for (const row of result.skipped) console.log(`  - ${row.domain}: ${row.reason}`);
  }
} else {
  console.log("Usage: pnpm list:check <domain...>  |  pnpm list:import <file.json>");
}
