import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { targetAccountByDomain } from "@/lib/target-accounts";

type TeamPerson = { id: string; full_name: string; title: string; level: string; email: string | null; email_status: string; email_source: string | null; linkedin_url: string | null };

/** The company's details and everyone on file there, for the desk's one-screen prospect flow. */
export async function GET(request: Request) {
  try {
    await requireUser();
    const domain = new URL(request.url).searchParams.get("domain")?.toLowerCase().trim();
    if (!domain) return Response.json({ error: "domain required" }, { status: 400 });
    const db = admin();
    const { data: account } = await db.from("accounts").select("id,name,domain,vertical,employee_range,tier,careers_url,intel_score").eq("domain", domain).maybeSingle();
    const people = account
      ? (((await db.from("people").select("id,full_name,title,level,email,email_status,email_source,linkedin_url").eq("account_id", account.id as string).eq("do_not_contact", false).order("level").order("full_name").limit(40)).data ?? []) as TeamPerson[])
      : [];
    const target = targetAccountByDomain.get(domain);
    return Response.json({
      account: account
        ? { name: account.name, domain: account.domain, vertical: account.vertical ?? target?.vertical ?? null, employees: account.employee_range ?? (target?.employees ? `${target.employees.toLocaleString()} employees` : null), tier: account.tier ?? target?.tier ?? null, revenueBand: target?.revenueBand ?? null, careersUrl: account.careers_url ?? null, intelScore: account.intel_score ?? 0 }
        : null,
      people,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 400 });
  }
}
