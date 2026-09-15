import Link from "next/link";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { Header } from "@/components/Header";
import { PeopleBoard, type PersonRow, type PeopleFilters } from "@/components/PeopleBoard";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = { q?: string; level?: string; email?: string; show?: string; sort?: string };

type AccountRef = { name: string; domain: string };
type PeopleRow = {
  id: string; full_name: string; title: string; level: string; email: string | null; email_status: string;
  linkedin_url: string | null; source: string | null; created_at: string | null; enriched_at: string | null;
  accounts: AccountRef | AccountRef[] | null;
};
type CardRow = { id: string; score: number; person_id: string; status: string };
type TouchRow = { person_id: string; sent_at: string | null; created_at: string; reply_at: string | null };

function peopleInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "•";
}

/** Every person the sweep or a signal has put on file — one instant-search directory. */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  {
    const pending = await pendingMigrations(admin());
    if (pending.length) return <MigrationRequired pending={pending} />;
  }
  const params = await searchParams;
  const db = admin();

  const [people, cards, touches, { count: verified }, { count: withLinkedIn }, { data: nextCards }] = await Promise.all([
    fetchAll<PeopleRow>((from, to) => db.from("people").select("id,full_name,title,level,email,email_status,linkedin_url,source,created_at,enriched_at,accounts!inner(name,domain)").eq("do_not_contact", false).range(from, to)),
    fetchAll<CardRow>((from, to) => db.from("cards").select("id,score,person_id,status").in("status", ["new", "approved", "edited"]).range(from, to)),
    fetchAll<TouchRow>((from, to) => db.from("touches").select("person_id,sent_at,created_at,reply_at").range(from, to)),
    db.from("people").select("*", { count: "exact", head: true }).eq("email_status", "verified"),
    db.from("people").select("*", { count: "exact", head: true }).not("linkedin_url", "is", null),
    db.from("cards").select("id,score,channel,people!inner(full_name,title),accounts!inner(name,domain,outreach)").eq("accounts.outreach", true).in("status", ["new", "approved", "edited"]).order("score", { ascending: false }).limit(8),
  ]);

  // Best open card per person, for a "draft ready" jump straight to the desk.
  const draftByPerson = new Map<string, { id: string; score: number }>();
  for (const card of cards) {
    const current = draftByPerson.get(card.person_id);
    if (!current || card.score > current.score) draftByPerson.set(card.person_id, { id: card.id, score: card.score });
  }
  // Outreach history per person: how many touches, when last, and whether they ever replied.
  const historyByPerson = new Map<string, { count: number; last: string; replied: boolean }>();
  for (const touch of touches) {
    const when = touch.sent_at ?? touch.created_at;
    const current = historyByPerson.get(touch.person_id);
    if (!current) historyByPerson.set(touch.person_id, { count: 1, last: when, replied: Boolean(touch.reply_at) });
    else { current.count += 1; if (when > current.last) current.last = when; if (touch.reply_at) current.replied = true; }
  }

  const rows: PersonRow[] = people.map((person) => {
    const account = (Array.isArray(person.accounts) ? person.accounts[0] : person.accounts) ?? null;
    const draft = draftByPerson.get(person.id);
    const history = historyByPerson.get(person.id);
    return {
      id: person.id,
      name: person.full_name,
      title: person.title ?? "",
      company: account?.name ?? "Unknown company",
      domain: account?.domain ?? "",
      level: person.level ?? "unknown",
      email: person.email,
      emailStatus: person.email_status ?? "none",
      linkedin: person.linkedin_url,
      source: person.source,
      createdAt: person.created_at,
      enrichedAt: person.enriched_at,
      draftCardId: draft?.id ?? null,
      draftScore: draft?.score ?? 0,
      touchCount: history?.count ?? 0,
      lastContactAt: history?.last ?? null,
      replied: history?.replied ?? false,
    };
  });

  const initial: PeopleFilters = {
    q: params.q ?? "",
    level: params.level ?? "",
    email: params.email ?? "",
    show: params.show ?? "",
    sort: params.sort ?? "best",
  };

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <header className="page-head briefing-head">
        <div><span className="overview-kick">People on file</span><h1>People</h1><p>Buyers and signal owners, enriched with email and LinkedIn where available · {rows.length.toLocaleString()} on file · {(verified ?? 0).toLocaleString()} verified · {(withLinkedIn ?? 0).toLocaleString()} on LinkedIn.</p></div>
      </header>

      {nextCards && nextCards.length > 0 && <section className="reach-next">
        <header><span className="eyebrow">Reach out next</span><Link href="/desk">Work the desk →</Link></header>
        <div className="reach-next-row">
          {nextCards.map((cardRow) => {
            const person = cardRow.people as unknown as { full_name: string; title: string } | null;
            const account = cardRow.accounts as unknown as { name: string; domain: string };
            if (!person) return null;
            return <Link key={cardRow.id as string} href={`/desk?card=${cardRow.id}`} className="reach-next-card">
              <span className="avatar">{peopleInitials(person.full_name)}</span>
              <div><strong>{person.full_name}</strong><small>{person.title || "title unknown"} · {account.name}</small></div>
              <span className="reach-next-score">{cardRow.score as number}</span>
            </Link>;
          })}
        </div>
      </section>}

      <PeopleBoard rows={rows} initial={initial} verified={verified ?? 0} withLinkedIn={withLinkedIn ?? 0} />
    </main>
  </div>;
}
