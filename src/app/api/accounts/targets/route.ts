import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { syncTargetAccounts } from "@/lib/sync-targets";
import { TARGET_ACCOUNT_SOURCE, TARGET_CUT_SOURCE } from "@/lib/target-accounts";

export const maxDuration = 60;

export async function POST() {
  try {
    await requireUser();
    const result = await syncTargetAccounts(admin());
    return Response.json({ ...result, source: TARGET_ACCOUNT_SOURCE, cut: TARGET_CUT_SOURCE });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Target import failed" }, { status: 400 });
  }
}
