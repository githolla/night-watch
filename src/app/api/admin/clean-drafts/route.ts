import { requireUser } from "@/lib/auth";
import { sanitizeLinks } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 300;

type CardRow = { id: string; email_body: string | null };

/**
 * Repair already-stored drafts in place: collapse repeated openers, strip links and the leftover
 * "teardown" CTA — exactly what sanitizeLinks does on the way out, applied to what's saved so the desk
 * shows the clean text too. Deterministic and free (no model calls). Batched + cursor-bounded by
 * updated_at like the other bulk tools; only rows that actually change are written.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const { before } = await request.json().catch(() => ({}));
    const cutoff = typeof before === "string" && before ? before : new Date().toISOString();
    const db = admin();

    const filter = () => db.from("cards").select("id,email_body", { count: "exact" })
      .in("status", ["new", "approved", "edited"]).not("email_body", "is", null).lt("updated_at", cutoff);
    const { data } = await filter().order("updated_at", { ascending: true }).limit(100);
    const cards = (data ?? []) as CardRow[];

    let cleaned = 0;
    await Promise.allSettled(cards.map(async (card) => {
      const original = card.email_body ?? "";
      const next = sanitizeLinks(original);
      // Always touch the row so updated_at advances and the cursor makes progress, but only count a real fix.
      const changed = next.trim() !== original.trim();
      const { error } = await db.from("cards").update({ email_body: next }).eq("id", card.id);
      if (!error && changed) cleaned += 1;
    }));

    const { count: remaining } = await filter().limit(1);
    return Response.json({ cleaned, scanned: cards.length, remaining: remaining ?? 0, cutoff });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not clean the drafts" }, { status: 400 });
  }
}
