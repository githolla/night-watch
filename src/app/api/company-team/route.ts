import { accountBrief } from "@/lib/dossier-data";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { isLikelyPersonName } from "@/lib/pipeline";
import { targetAccountByDomain } from "@/lib/target-accounts";
import { decodeEntities, foreignEmployer, isRealContact, looksLikeCompanyBrand } from "@/lib/clean";

type TeamPerson = { id: string; full_name: string; title: string; level: string; email: string | null; email_status: string; email_source: string | null; linkedin_url: string | null; sentAt?: string | null };

/** The company's details and everyone on file there, for the desk's one-screen prospect flow. */
export async function GET(request: Request) {
  try {
    await requireUser();
    const domain = new URL(request.url).searchParams.get("domain")?.toLowerCase().trim();
    if (!domain) return Response.json({ error: "domain required" }, { status: 400 });
    const db = admin();
    const { data: account } = await db.from("accounts").select("id,name,domain,vertical,employee_range,tier,careers_url,intel_score").eq("domain", domain).maybeSingle();
    const brief = accountBrief(domain);
    if (brief) {
      const stored = account ? await db.from("people").select("id,full_name,title,level,email,email_status,email_source,linkedin_url,do_not_contact").eq("account_id", account.id) : { data: [], error: null };
      if (stored.error) throw stored.error;
      const people = [...brief.contacts].sort((a, b) => a.contact_rank - b.contact_rank).map(contact => {
        const name = `${contact.first_name} ${contact.last_name}`;
        const match = stored.data?.find(person => person.full_name.trim().toLowerCase() === name.toLowerCase());
        return { id: match?.id ?? contact.contact_id, full_name: name, title: contact.title, level: match?.level ?? "owner", email: match?.email ?? null, email_status: match?.email_status ?? "none", email_source: match?.email_source ?? null, linkedin_url: match?.linkedin_url ?? null, do_not_contact: match?.do_not_contact ?? false, contact_rank: contact.contact_rank };
      });
      return Response.json({ account, people });
    }
    const people = account
      ? (((await db.from("people").select("id,full_name,title,level,email,email_status,email_source,linkedin_url").eq("account_id", account.id as string).eq("do_not_contact", false).order("level").order("full_name").limit(60)).data ?? []) as TeamPerson[])
        // Drop marketing phrases ("Strategic IT Guidance", "Reduced Operational Costs") that slipped in as "people".
        .filter((person) => isLikelyPersonName(person.full_name))
        // Decode on the way out too: contacts stored before this was fixed still carry raw entities.
        .map((person) => ({ ...person, full_name: decodeEntities(person.full_name), title: decodeEntities(person.title) }))
        // And hide the ones whose own title says they work somewhere else. Applying the rule on read as
        // well as on write means contacts already on file stop being offered without a migration.
        .filter((person) => !foreignEmployer(person.title, (account.name as string) ?? "", account.domain as string))
        // And the ones that are not a person at all: a functional mailbox (recruiting@, service@) or a page
        // title scraped as a contact ("Modern Slavery Statement").
        .filter((person) => isRealContact(person))
        // And the company's own products, filed under its own name: "ModMed Pay" at ModMed.
        .filter((person) => !looksLikeCompanyBrand(person.full_name, account.name as string))
      : [];
    // Who here has already been written to. Held only in the browser before now, so every reload forgot it
    // and the same colleague could be emailed twice by someone who could not see the first one.
    if (people.length) {
      const { data: touches } = await db.from("touches")
        .select("person_id,sent_at")
        .in("person_id", people.map((person) => person.id))
        .eq("channel", "email")
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false });
      const lastSent = new Map<string, string>();
      for (const row of (touches ?? []) as Array<{ person_id: string; sent_at: string }>) {
        if (!lastSent.has(row.person_id)) lastSent.set(row.person_id, row.sent_at);
      }
      for (const person of people) person.sentAt = lastSent.get(person.id) ?? null;
    }

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
