import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

// Either a picked company id (from the admin search) or a typed domain.
const input = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  domain: z.string().trim().max(200).optional(),
}).refine((value) => Boolean(value.id || value.domain), { message: "Pick a company or enter its domain." });

const normalizeDomain = (raw: string) =>
  raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/**
 * Take a company off the reach-out list by hand — e.g. an AI-native product company where the
 * "replace the hire" pitch doesn't apply. Sets outreach=false and marks it hand-decided
 * (outreach_manual), which the nightly file sync respects, so it stays off even though the company is
 * still on the imported target file. Any un-sent cards for it are dismissed so it leaves the desk now.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const picked = input.parse(await request.json().catch(() => ({})));
    const db = admin();
    // Prefer the id picked from the search — it's unambiguous. Fall back to a typed domain.
    const lookup = picked.id
      ? db.from("accounts").select("id,name,domain").eq("id", picked.id)
      : db.from("accounts").select("id,name,domain").eq("domain", normalizeDomain(picked.domain ?? ""));
    const { data: account } = await lookup.maybeSingle();
    if (!account) return Response.json({ error: picked.id ? "That company is no longer on the list." : `No company on the list with the domain ${normalizeDomain(picked.domain ?? "")}.` }, { status: 404 });
    const domain = account.domain as string;

    const { error } = await db.from("accounts").update({ outreach: false, outreach_manual: true }).eq("id", account.id);
    if (error) return Response.json({ error: error.message }, { status: 400 });

    // Clear it off the desk: dismiss anything still un-sent. Sent/replied history is left untouched.
    const { data: cleared } = await db.from("cards").update({ status: "dismissed" })
      .eq("account_id", account.id).in("status", ["new", "approved", "edited"]).select("id");

    return Response.json({ ok: true, name: account.name, domain, dismissed: cleared?.length ?? 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not remove the company" }, { status: 400 });
  }
}
