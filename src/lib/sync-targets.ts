import type { SupabaseClient } from "@supabase/supabase-js";
import { activeTargetAccounts, OUTREACH_TIERS, targetAccountRowBatches, targetAccounts } from "./target-accounts.ts";

const DEMO_DOMAINS = ["northstarhealth.example", "harborsystems.example", "meridianfoods.example", "aperturecloud.example", "willowcommerce.example"];

function batches<T>(items: T[], size = 200) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

/**
 * Write the target file and its reach-out cut to the database. Idempotent:
 * every company is upserted by domain with its tier, removed companies are
 * paused, companies no longer on the file are paused, and the reach-out flag
 * follows the tier unless someone decided by hand on the company page.
 */
export async function syncTargetAccounts(db: SupabaseClient) {
  const { error: cleanupError } = await db.from("accounts").delete().in("domain", DEMO_DOMAINS);
  if (cleanupError) throw cleanupError;

  let imported = 0;
  for (const batch of targetAccountRowBatches()) {
    const { data, error } = await db.from("accounts").upsert(batch, { onConflict: "domain" }).select("id");
    if (error) throw error;
    imported += data?.length ?? 0;
  }

  const { error: promoteError } = await db.from("accounts").update({ outreach: true }).in("tier", OUTREACH_TIERS).is("outreach_manual", null).eq("outreach", false);
  if (promoteError) throw promoteError;
  const { error: demoteError } = await db.from("accounts").update({ outreach: false }).or(`tier.is.null,tier.not.in.(${OUTREACH_TIERS.join(",")})`).is("outreach_manual", null).eq("outreach", true);
  if (demoteError) throw demoteError;

  const targetDomains = new Set(targetAccounts.map((account) => account.domain));
  const active: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("accounts").select("domain").eq("status", "active").range(from, from + 999);
    if (error) throw error;
    active.push(...(data ?? []).map((account) => account.domain as string));
    if ((data?.length ?? 0) < 1000) break;
  }
  const stale = active.filter((domain) => !domain.endsWith(".example") && !targetDomains.has(domain));
  for (const batch of batches(stale)) {
    const { error } = await db.from("accounts").update({ status: "paused" }).in("domain", batch);
    if (error) throw error;
  }

  return {
    imported,
    total: activeTargetAccounts.length,
    outreach: targetAccounts.filter((account) => account.outreach).length,
    removed: targetAccounts.length - activeTargetAccounts.length,
    paused: stale.length,
  };
}

/**
 * True when the database does not yet reflect the file: fewer reach-out
 * companies than the cut names, or companies without a tier. Cheap: two counts.
 */
export async function targetsNeedSync(db: SupabaseClient) {
  const [{ count: onList }, { count: untiered }] = await Promise.all([
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").eq("outreach", true),
    db.from("accounts").select("*", { count: "exact", head: true }).not("domain", "like", "%.example").is("tier", null),
  ]);
  return (onList ?? 0) < targetAccounts.filter((account) => account.outreach).length || (untiered ?? 0) > 0;
}
