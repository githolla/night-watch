import { requireUser } from "@/lib/auth";
import { sanitizeLinks } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 300;

type CardRow = { id: string; email_body: string | null; people: { full_name: string } | null };

// Strip the existing opening so a freshly chosen greeting REPLACES it instead of stacking on top:
//  - a standard greeting line ("Hi Mike," / "Hello Mike,"), on its own line or inline; and then
//  - any leading short standalone opener paragraphs — e.g. a previously-applied "TEST" — which re-applying
//    would otherwise pile up (the bug that produced "TEST / TEST / Nice to meet you…"). A first line ending
//    in sentence punctuation is real body copy, so it's kept.
const stripGreeting = (body: string) => {
  let out = body.replace(/^\s+/, "").replace(/^(?:hi|hey|hello|dear)\s+[^,\n]+?\s*,[ \t]*\n+/i, "");
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/^([^\n]{1,60})\n\s*\n/, (whole, line: string) => (/[.!?:]["')\]]?\s*$/.test(line.trim()) ? whole : ""));
    if (next === out) break;
    out = next;
  }
  return out.replace(/^\s+/, "");
};

// Blanket greeting: set the same opening line on every un-sent email draft. `{first}`/`{name}` are
// replaced with the contact's first name. Batched + cursor-bounded by updated_at like the rewrite tool.
export async function POST(request: Request) {
  const user = await requireUser();
  if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
  const { greeting, before } = await request.json().catch(() => ({}));
  const template = typeof greeting === "string" ? greeting.trim() : "";
  if (!template) return Response.json({ error: "Type a greeting first (use {first} for the first name)." }, { status: 400 });
  const cutoff = typeof before === "string" && before ? before : new Date().toISOString();
  const db = admin();

  const filter = () => db.from("cards").select("id,email_body,people(full_name)", { count: "exact" })
    .in("status", ["new", "approved", "edited"]).not("email_body", "is", null).lt("updated_at", cutoff);
  const { data } = await filter().order("updated_at", { ascending: true }).limit(50);
  const cards = (data ?? []) as unknown as CardRow[];

  let applied = 0;
  await Promise.allSettled(cards.map(async (card) => {
    const first = (card.people?.full_name ?? "").trim().split(/\s+/)[0] || "there";
    const line = template.replace(/\{first\}|\{name\}/gi, first).trim();
    const rest = stripGreeting(card.email_body ?? "");
    const body = sanitizeLinks(`${line}\n\n${rest}`);
    const { error } = await db.from("cards").update({ email_body: body }).eq("id", card.id);
    if (!error) applied++;
  }));
  const { count: remaining } = await filter().limit(1);
  return Response.json({ applied, remaining: remaining ?? 0, cutoff });
}
