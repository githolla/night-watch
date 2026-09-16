import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { buildCallBrief } from "@/lib/call-brief";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const pending = await pendingMigrations(admin());
  if (pending.length) return <MigrationRequired pending={pending} />;

  const db = admin();
  const { id } = await params;
  const { data: card } = await db
    .from("cards")
    .select("id,why_now,email_subject,email_body,meeting_at,account_id,person_id,accounts(name,domain,vertical,employee_range),people(full_name,title,email,linkedin_url),signals(raw)")
    .eq("id", id)
    .maybeSingle();
  if (!card) notFound();

  const account = card.accounts as unknown as { name: string; domain: string; vertical: string | null; employee_range: string | null } | null;
  const person = card.people as unknown as { full_name: string; title: string; email: string | null; linkedin_url: string | null } | null;
  const signal = card.signals as unknown as { raw: { operating_need?: string } | null } | null;

  const [{ data: roleRows }, { data: postRows }, { data: touchRows }] = await Promise.all([
    db.from("job_postings").select("title").eq("account_id", card.account_id as string).eq("active", true).limit(12),
    db.from("public_posts").select("author_name,topic").eq("account_id", card.account_id as string).limit(6),
    db.from("touches").select("channel,sent_at,created_at,reply_at").eq("card_id", id as string).order("created_at"),
  ]);

  const brief = buildCallBrief({
    person: person ?? { full_name: "Unknown", title: "", email: null, linkedin_url: null },
    account: { name: account?.name ?? "the company", domain: account?.domain ?? "", vertical: account?.vertical ?? null, employees: account?.employee_range ?? null },
    whyNow: (card.why_now as string) ?? "",
    operatingNeed: signal?.raw?.operating_need ?? null,
    roles: (roleRows ?? []).map((r) => r.title as string).filter(Boolean),
    posts: (postRows ?? []).map((p) => ({ author: p.author_name as string, topic: p.topic as string })),
    emailSubject: (card.email_subject as string | null) ?? null,
    emailBody: (card.email_body as string | null) ?? null,
    meetingAt: (card.meeting_at as string | null) ?? null,
    history: (touchRows ?? []).map((t) => ({ channel: t.channel as string, at: (t.sent_at as string | null) ?? (t.created_at as string), replied: Boolean(t.reply_at) })),
  });

  const meeting = brief.meetingAt ? new Date(brief.meetingAt).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

  return <div className="shell">
    <Header />
    <main className="pipeline pipeline-work">
      <div className="brief">
        <div className="brief-head">
          <div><span className="overview-kick">Call brief</span><h1>{brief.who}</h1><p>{brief.role} · {brief.company}</p></div>
          <div className="brief-head-right">
            {meeting && <span className="brief-meeting">📅 {meeting}</span>}
            {account?.domain && <Link href={`/accounts/${account.domain}`} className="focus-link">Company details ↗</Link>}
          </div>
        </div>

        {brief.facts.length > 0 && <div className="brief-facts">{brief.facts.map((f, i) => <span key={i}>{f}</span>)}</div>}

        <section className="brief-block">
          <h2>Why this conversation</h2>
          <p>{brief.whyNow}</p>
          {brief.build && <p className="brief-build"><b>What Nine-67 would build:</b> {brief.build}</p>}
          {brief.proposed && <p className="brief-muted">{brief.proposed}</p>}
        </section>

        <div className="brief-grid">
          <section className="brief-block">
            <h2>Discovery — what to probe</h2>
            <ol className="brief-list">{brief.discovery.map((q, i) => <li key={i}>{q}</li>)}</ol>
          </section>
          <section className="brief-block">
            <h2>Talking points</h2>
            <ul className="brief-list">{brief.talkingPoints.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </section>
        </div>

        <section className="brief-block">
          <h2>Contact</h2>
          <p className="brief-contact">
            {brief.who} · {brief.role}
            {person?.email ? <> · <a href={`mailto:${person.email}`}>{person.email}</a></> : null}
            {person?.linkedin_url ? <> · <a href={person.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a></> : null}
          </p>
          {brief.history.length > 0 && <p className="brief-muted">Touches: {brief.history.map((h) => `${h.label}${h.replied ? " (replied)" : ""}`).join(" · ")}</p>}
        </section>
      </div>
    </main>
  </div>;
}
