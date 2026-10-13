import type { SupabaseClient } from "@supabase/supabase-js";
import { focusForOwner } from "../focus-data.ts";
import { loadNightlyLists } from "../nightly-lists.ts";
import { loadMapCompanies } from "./load.ts";
import type { Company } from "./graph.ts";
export function targetMembership(owner: "josh" | "suuchi") {
  const today = focusForOwner(owner, 3);
  const groups = [{ label: "First 25", rows: focusForOwner(owner, 1) }, { label: "Next 25", rows: focusForOwner(owner, 2) }, { label: `Today's ${today.length}`, rows: today }];
  return new Map(groups.flatMap((group) => group.rows.map((row) => [row.domain.toLowerCase().replace(/^www\./, ""), { list: group.label, owner }] as const)));
}
export async function loadTargetCompanies(db: SupabaseClient, owner: "josh" | "suuchi"): Promise<Company[]> {
  await loadNightlyLists(db);
  const membership = targetMembership(owner);
  const companies = await loadMapCompanies(db, "", [...membership.keys()]);
  return companies.map((company) => ({ ...company, outreachList: membership.get(company.domain.toLowerCase().replace(/^www\./, ""))?.list ?? null, listOwner: owner }));
}
