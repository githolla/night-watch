import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { TARGET_ACCOUNT_SOURCE, targetAccountRows, targetAccounts } from "@/lib/target-accounts";

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
      total: targetAccounts.length,
      paused: staleDomains.length,
      source: TARGET_ACCOUNT_SOURCE,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Target import failed" },
      { status: 400 },
    );
  }
}
