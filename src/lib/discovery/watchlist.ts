import type { SupabaseClient } from "@supabase/supabase-js";
import { allFocus } from "../focus-data.ts";
import { sourceConfigSchema, type SourceConfig } from "./domain.ts";
import { check } from "./store.ts";

/** Monitor listed companies, not the full account database. Latest lists override older research. */
export async function knownTargetSites(db: SupabaseClient): Promise<SourceConfig[]> {
  const { data, error } = await db.from("reachout_lists").select("rows,owner").eq("status", "ready").order("list_date", { ascending: false }).limit(12);
  check(error);
  const targets = new Map<string, { company: string; owner?: "josh" | "suuchi" }>();
  for (const list of data ?? []) if (Array.isArray(list.rows)) for (const value of list.rows) {
    if (!value || typeof value !== "object" || !("domain" in value) || !("company" in value) || typeof value.domain !== "string" || typeof value.company !== "string") continue;
    const domain = value.domain.toLowerCase().replace(/^www\./, ""); if (!targets.has(domain)) targets.set(domain, { company: value.company, ...(list.owner === "josh" || list.owner === "suuchi" ? { owner: list.owner } : {}) });
  }
  for (const row of allFocus()) if (!targets.has(row.domain)) targets.set(row.domain, { company: row.company, owner: "assignedOwner" in row && row.assignedOwner === "suuchi" ? "suuchi" : "josh" });
  const domains = [...targets.keys()];
  if (!domains.length) return [];
  const excluded = await db.from("accounts").select("domain").in("domain", domains).in("status", ["client", "do_not_contact"]);
  check(excluded.error);
  const blocked = new Set((excluded.data ?? []).map(row => row.domain));
  return [...targets].filter(([domain]) => !blocked.has(domain)).flatMap(([domain, target]) => {
    const { company, owner } = target;
    const source = sourceConfigSchema.safeParse({ id: `site_${domain.replace(/[^a-z0-9]/g, "_")}`, provider: "company_site", label: `${company} website`, value: `https://${domain}/`, company, domain, owner, enabled: true, permission_reference: "Operator-authorized research of public target-company pages; no login or private content." });
    return source.success ? [source.data] : [];
  });
}
