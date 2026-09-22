import { requireAdmin } from "@/lib/auth";
import { repairBrokenDrafts } from "@/lib/draft-repair";

export const maxDuration = 60;
/** Runs after rendering. Reuses the existing untouched/broken-only, concurrent-edit-safe repair. */
export async function POST() {
  try {
    await requireAdmin();
    const result = await repairBrokenDrafts(2000, 20_000);
    if (!result.done && result.checked === 0) return Response.json({ error: "Could not read drafts. Try again later." }, { status: 503 });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Draft update failed" }, { status: 400 });
  }
}
