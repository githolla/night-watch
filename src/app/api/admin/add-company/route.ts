import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(200),
  vertical: z.string().trim().max(200).optional(),
  tier: z.enum(["A1", "A2", "B", "C"]).default("A1"),
});

// Normalize a pasted website/domain to the bare host the accounts table keys on (matches
// domainFromWebsite in target-accounts.ts).
const normalizeDomain = (raw: string) =>
  raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

// Add a company to the reach-out list by hand. Persists an active account marked outreach_manual so the
// nightly file sync neither demotes its outreach flag nor pauses it as "not on the file". Upsert by domain,
// so re-adding an existing company just refreshes it rather than erroring.
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const parsed = input.parse(await request.json().catch(() => ({})));
    const domain = normalizeDomain(parsed.domain);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return Response.json({ error: "Enter a valid domain, e.g. shawinc.com" }, { status: 400 });
    const outreach = parsed.tier === "A1" || parsed.tier === "A2";
    const db = admin();
    const { data, error } = await db.from("accounts").upsert({
      name: parsed.name,
      domain,
      vertical: parsed.vertical || "",
      status: "active",
      tier: parsed.tier,
      outreach,
      // Hand-decided: protects the row from the file sync's auto-demote and stale-pause.
      outreach_manual: true,
      target_titles: [],
      news_query: `"${parsed.name}" (AI OR automation OR operations OR data OR hiring)`,
    }, { onConflict: "domain" }).select("id,name,domain,tier,outreach").single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, account: data });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not add the company" }, { status: 400 });
  }
}
