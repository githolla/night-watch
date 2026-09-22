import { requireUser } from "@/lib/auth";
import { sanitizeSignatureHtml } from "@/lib/clean";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({
  from_name: z.string().max(120),
  title: z.string().max(120),
  signature: z.string().max(20000), // large enough for a pasted/uploaded HTML signature
  website: z.string().max(160).optional(),
  location: z.string().max(160).optional(),
  cc: z.array(z.string().trim().min(3).max(160)).max(10),
  greeting: z.string().max(160).optional(),
  signoff: z.string().max(160).optional(),
  intro: z.string().max(300).optional(),
});

// The two columns a repair script adds. Until it has been run they do not exist, and naming one in an
// upsert fails the whole save — so the identity form would stop saving a name or a signature because of a
// field the operator had not enabled yet.
const ADDED_BY_REPAIR = ["greeting", "signoff", "intro"] as const;
const missingColumn = (message: string) => ADDED_BY_REPAIR.find((column) => new RegExp(`'${column}' column|column "?${column}"?`, "i").test(message));

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = input.parse(await request.json());
    const db = admin();
    // Sanitize on WRITE so the stored signature is already safe everywhere it's used — the settings preview
    // renders it as HTML and it ships inside every outbound email. Hand-rolled client-side stripping was
    // bypassable (`<img src=x/onerror=…>`), which let it run in an admin's browser.
    const signature = sanitizeSignatureHtml(body.signature);
    const row: Record<string, unknown> = {
      owner: user.owner, from_name: body.from_name, title: body.title, signature,
      website: body.website ?? "", location: body.location ?? "", cc: body.cc,
      greeting: (body.greeting ?? "").trim(), signoff: (body.signoff ?? "").trim(), intro: (body.intro ?? "").trim(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from("sender_profiles").upsert(row, { onConflict: "owner" });
    if (!error) return Response.json({ ok: true });

    // The greeting columns are not there yet: save everything else rather than losing the whole form, and
    // say plainly which part did not stick and what makes it stick.
    const column = missingColumn(error.message);
    if (!column) throw new Error(error.message);
    for (const name of ADDED_BY_REPAIR) delete row[name];
    const { error: retry } = await db.from("sender_profiles").upsert(row, { onConflict: "owner" });
    if (retry) throw new Error(retry.message);
    return Response.json({ ok: true, warning: "Saved — except your greeting, sign-off and introduction. Run supabase/repair/0025_sender_greeting.sql in the Supabase SQL editor to turn those on." });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Save failed" }, { status: 400 });
  }
}
