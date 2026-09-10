import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { TARGET_ACCOUNT_SOURCE, targetAccountRows, targetAccounts } from "@/lib/target-accounts";

const demoDomains = [
  "northstarhealth.example",
  "harborsystems.example",
  "meridianfoods.example",
  "aperturecloud.example",
  "willowcommerce.example",
];

export async function POST() {
  try {
    await requireUser();
    const db = admin();
    const { error: cleanupError } = await db.from("accounts").delete().in("domain", demoDomains);
    if (cleanupError) throw cleanupError;

    const { data, error } = await db
      .from("accounts")
      .upsert(targetAccountRows(), { onConflict: "domain" })
      .select("id");
    if (error) throw error;

    return Response.json({
      imported: data?.length ?? 0,
      total: targetAccounts.length,
      source: TARGET_ACCOUNT_SOURCE,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Target import failed" },
      { status: 400 },
    );
  }
}
