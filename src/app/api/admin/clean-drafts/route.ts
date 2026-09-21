import { requireUser } from "@/lib/auth";
import { sanitizeLinks } from "@/lib/sender";
import { dedupeParagraphs } from "@/lib/clean";
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
    const body = await request.json().catch(() => ({}));
    // Offset pagination, NOT an updated_at cursor: this tool deliberately leaves untouched rows alone, so
    // there is nothing to advance a timestamp cursor and the drain would re-read the same page forever.
    const offset = Number.isFinite(Number(body?.offset)) ? Math.max(0, Math.floor(Number(body.offset))) : 0;
    const PAGE = 100;
    const db = admin();

    const { data, count } = await db.from("cards").select("id,email_body", { count: "exact" })
      .in("status", ["new", "approved", "edited"]).not("email_body", "is", null)
      .order("id", { ascending: true }).range(offset, offset + PAGE - 1);
    const cards = (data ?? []) as CardRow[];

    let cleaned = 0;
    let skipped = 0;
    await Promise.allSettled(cards.map(async (card) => {
      const original = card.email_body ?? "";
      const next = sanitizeLinks(dedupeParagraphs(original));
      const changed = next.trim() !== original.trim();
      // Never blank a draft, and never rewrite a row that needs no fix — an unconditional write bumped
      // updated_at on every card and scrambled recency for no reason.
      if (!changed) return;
      if (!next.trim()) { skipped += 1; return; }
      const { error } = await db.from("cards").update({ email_body: next }).eq("id", card.id);
      if (!error) cleaned += 1;
    }));

    const nextOffset = offset + cards.length;
    const remaining = Math.max(0, (count ?? nextOffset) - nextOffset);
    return Response.json({ cleaned, skipped, scanned: cards.length, offset: nextOffset, remaining, done: cards.length < PAGE || remaining === 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not clean the drafts" }, { status: 400 });
  }
}
