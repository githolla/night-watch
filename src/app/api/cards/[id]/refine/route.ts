import { requireUser } from "@/lib/auth";
import { refineDraft } from "@/lib/agents";
import { senderProfile } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";
import { spendTally } from "@/lib/spend";
import { z } from "zod";

const input = z.object({
  channel: z.enum(["email", "linkedin"]),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(4000),
  instruction: z.string().max(400).optional(),
  // When the desk targets a specific contact (name/title), personalize to them, not the card's default person.
  personName: z.string().max(120).optional(),
  personTitle: z.string().max(160).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const payload = input.parse(await request.json());
    const db = admin();
    const { data: card } = await db.from("cards").select("id,why_now,people(full_name,title),accounts(name)").eq("id", id).single();
    if (!card) throw new Error("Card not found");
    const person = card.people as unknown as { full_name: string; title: string } | null;
    const account = card.accounts as unknown as { name: string } | null;
    const sender = await senderProfile(db, "josh");
    const tally = spendTally("refine_draft", { cardId: id, channel: payload.channel });
    const refined = await refineDraft({
      channel: payload.channel,
      company: account?.name ?? "the company",
      person: payload.personName ?? person?.full_name ?? "there",
      title: payload.personTitle ?? person?.title ?? "",
      whyNow: (card.why_now as string) ?? "",
      subject: payload.subject,
      body: payload.body,
      instruction: payload.instruction,
      senderName: sender.fromName,
      senderTitle: sender.title,
    }, tally.record);
    await tally.flush();
    const patch = payload.channel === "email"
      ? { email_subject: refined.subject ?? payload.subject ?? null, email_body: refined.body }
      : { linkedin_subject: refined.subject ?? payload.subject ?? null, linkedin_message: refined.body };
    // Still return the rewrite even if persisting a column lags a pending migration, so the desk always updates.
    const { error: saveError } = await db.from("cards").update(patch).eq("id", id);
    return Response.json({ ok: true, ...refined, persisted: !saveError });
  } catch (error) {
    return Response.json({ error: humanizeError(error) }, { status: 400 });
  }
}

/** Turn a raw model/API error into one clean sentence for the desk instead of a wall of JSON. */
function humanizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  let message = raw;
  const match = raw.match(/"message"\s*:\s*"([^"]+)"/); // pull the human line out of an Anthropic error blob
  if (match) message = match[1];
  if (/usage limit/i.test(message)) {
    const when = message.match(/regain access on ([0-9]{4}-[0-9]{2}-[0-9]{2}[^."]*)/i);
    return `AI writing is paused — the Nine-67 workspace hit its Anthropic API spend limit${when ? `, back ${when[1].trim()} UTC` : ""}. Edit the draft by hand for now, or raise the workspace limit in the Anthropic console.`;
  }
  if (/rate limit|overloaded|529|429/i.test(message)) return "The model is busy right now — try Refine again in a moment.";
  if (/api key|authentication|401/i.test(message)) return "The Anthropic API key is missing or invalid — check the workspace settings.";
  return message.length > 200 ? "Could not refine right now — please try again." : message;
}
