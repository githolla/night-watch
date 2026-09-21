import { requireUser } from "@/lib/auth";
import { sanitizeLinks, similarText } from "@/lib/sender";
import { dedupeParagraphs } from "@/lib/clean";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 60;

type CardRow = { id: string; email_body: string | null; people: { full_name: string } | null };

/**
 * Read-only: how many un-sent drafts a bulk tool would actually change, and what a few of them would look
 * like afterwards. Nothing is written.
 *
 * Deliberately a separate route rather than a `preview` flag on the apply routes: those routes work, and
 * adding a branch that must not write to code whose whole job is writing is how a preview turns into an
 * accidental edit. This one has no update call in it at all.
 */
const SAMPLE_SIZE = 3;
const SCAN = 300;

/** Mirrors apply-greeting's opener strip so the preview shows what that tool would really produce. */
const stripGreeting = (body: string, line: string) => {
  let out = body.replace(/^\s+/, "").replace(/^(?:hi|hey|hello|dear|good (?:morning|afternoon|evening))\b[^\n,]*,[ \t]*\n*/i, "").replace(/^\s+/, "");
  const norm = line.trim();
  if (norm) {
    for (let i = 0; i < 8; i++) {
      const block = out.match(/^([\s\S]*?)(?:\n\s*\n|$)/);
      const paragraph = (block?.[1] ?? "").trim();
      if (!paragraph || !block) break;
      if (paragraph.toLowerCase() !== norm.toLowerCase() && !similarText(paragraph, norm)) break;
      out = out.slice(block[0].length).replace(/^\s+/, "");
    }
  }
  return out.replace(/^\s+/, "");
};

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const tool = body?.tool === "greeting" ? "greeting" : "clean";
    const template = typeof body?.greeting === "string" ? body.greeting.trim() : "";
    if (tool === "greeting" && !template) return Response.json({ error: "Type a greeting first." }, { status: 400 });

    const db = admin();
    const base = () => db.from("cards").select("id,email_body,people(full_name)", { count: "exact" })
      .in("status", ["new", "approved", "edited"]).not("email_body", "is", null);

    const { data, count: total } = await base().order("id", { ascending: true }).limit(SCAN);
    const cards = (data ?? []) as unknown as CardRow[];

    let wouldChange = 0;
    const samples: Array<{ name: string; before: string; after: string }> = [];
    for (const card of cards) {
      const before = card.email_body ?? "";
      const first = (card.people?.full_name ?? "").trim().split(/\s+/)[0] || "there";
      const after = tool === "greeting"
        ? sanitizeLinks(`${template.replace(/\{first\}|\{name\}/gi, first).trim()}\n\n${stripGreeting(before, template.replace(/\{first\}|\{name\}/gi, first).trim())}`)
        : sanitizeLinks(dedupeParagraphs(before));
      if (after.trim() === before.trim() || !after.trim()) continue;
      wouldChange += 1;
      if (samples.length < SAMPLE_SIZE) samples.push({ name: card.people?.full_name ?? "A contact", before, after });
    }

    return Response.json({
      total: total ?? cards.length,
      scanned: cards.length,
      wouldChange,
      // Past SCAN rows the count is what we saw in the sample window, not the whole list — say so rather
      // than implying an exact figure.
      exact: (total ?? 0) <= SCAN,
      samples,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not preview" }, { status: 400 });
  }
}
