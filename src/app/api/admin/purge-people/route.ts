import { requireUser } from "@/lib/auth";
import { purgeNonPeople } from "@/lib/pipeline";

/** Permanently delete rows scraped as "people" that are really service lines or value props
 *  ("Strategic IT Guidance", "Reduced Operational Costs"). Their cards cascade away with them.
 *  Read-time filters already hide these; this cleans the database so they stop counting and being enriched. */
export async function POST() {
  try {
    await requireUser();
    const removed = await purgeNonPeople();
    return Response.json({ ok: true, removed });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Purge failed" }, { status: 400 });
  }
}
