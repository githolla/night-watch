import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { activeTargetAccounts, OUTREACH_TIERS, TARGET_ACCOUNT_SOURCE, TARGET_CUT_SOURCE, targetAccountRows, targetAccounts } from "@/lib/target-accounts";

export const maxDuration = 60;

const demoDomains = [
  "northstarhealth.example",
  "harborsystems.example",
  "meridianfoods.example",
  "aperturecloud.example",
  "willowcommerce.example",
];

const batchSize = 200;

function batches<T>(items: T[]) {
  return Array.from({ length: Math.ceil(items.length / batchSize) }, (_, index) =>
    items.slice(index * batchSize, (index + 1) * batchSize),
  );
}

async function activeDomains() {
  const db = admin();
  const domains: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("accounts")
      .select("domain")
      .eq("status", "active")
      .range(from, from + 999);
    if (error) throw error;
    domains.push(...(data ?? []).map((account) => account.domain));
    if ((data?.length ?? 0) < 1000) return domains;
  }
}

export async function POST() {
  try {
    await requireUser();
    const db = admin();
    const { error: cleanupError } = await db.from("accounts").delete().in("domain", demoDomains);
    if (cleanupError) throw cleanupError;

    let imported = 0;
    for (const batch of batches(targetAccountRows())) {
      const { data, error } = await db
        .from("accounts")
        .upsert(batch, { onConflict: "domain" })
        .select("id");
      if (error) throw error;
      imported += data?.length ?? 0;
    }

    // The reach-out flag follows the tier unless someone set it by hand on the company page.
    const { error: promoteError } = await db.from("accounts").update({ outreach: true }).in("tier", OUTREACH_TIERS).is("outreach_manual", null).eq("outreach", false);
    if (promoteError) throw promoteError;
    const { error: demoteError } = await db.from("accounts").update({ outreach: false }).or(`tier.is.null,tier.not.in.(${OUTREACH_TIERS.join(",")})`).is("outreach_manual", null).eq("outreach", true);
    if (demoteError) throw demoteError;

    const targetDomains = new Set(targetAccounts.map((account) => account.domain));
    const staleDomains = (await activeDomains()).filter(
      (domain) => !domain.endsWith(".example") && !targetDomains.has(domain),
    );
    for (const batch of batches(staleDomains)) {
      const { error } = await db.from("accounts").update({ status: "paused" }).in("domain", batch);
      if (error) throw error;
    }

    return Response.json({
      imported,
      total: activeTargetAccounts.length,
      outreach: targetAccounts.filter((account) => account.outreach).length,
      removed: targetAccounts.length - activeTargetAccounts.length,
      paused: staleDomains.length,
      source: TARGET_ACCOUNT_SOURCE,
      cut: TARGET_CUT_SOURCE,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Target import failed" },
      { status: 400 },
    );
  }
}
