import { MigrationRequired } from "@/components/MigrationRequired";
import { BriefActions } from "@/components/BriefActions";
import { pendingMigrations } from "@/lib/schema-check";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { buildCallBrief } from "@/lib/call-brief";
import { allFocus } from "@/lib/focus-data";
import { loadNightlyLists } from "@/lib/nightly-lists";
import type { AiFit } from "@/lib/ai-fit";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

type ListResearch = { sector?: string; reframe?: string; limitations?: string[]; trigger?: { fact?: string; sourceUrl?: string | null }; aiFit?: AiFit; revenue?: { usdMillions?: number | null; year?: number | null; status?: string | null; employees?: number | null } };

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  // Check the schema while sign-in is checked, instead of one round trip after it.
  const schemaCheck = pendingMigrations(admin()).catch(() => []);
  await requireUser();
  const pending = await schemaCheck;
  if (pending.length) return <MigrationRequired pending={pending} />;

  const db = admin();
  const { id } = await params;
  const [{ data: card }] = await Promise.all([
    db.from("cards")
      .select("id,why_now,email_subject,email_body,meeting_at,account_id,person_id,assigned_to,accounts(name,domain,vertical,employee_range),people(full_name,title,email,linkedin_url),signals(raw)")
      .eq("id", id).maybeSingle(),
    // The list rows carry the research: fit reasons with sources, the idea pitched, and what is not known.
    loadNightlyLists(db).catch(() => undefined),
  ]);
  if (!card) notFound();

  const account = card.accounts as unknown as { name: string; domain: string; vertical: string | null; employee_range: string | null } | null;
  const person = card.people as unknown as { full_name: string; title: string; email: string | null; linkedin_url: string | null } | null;
  const signal = card.signals as unknown as { raw: { operating_need?: string } | null } | null;
  const row = account?.domain ? allFocus().find((item) => item.domain.toLowerCase() === account.domain.toLowerCase()) as ListResearch | undefined : undefined;
  const revenue = row?.revenue;
  const sizeLabel = revenue?.status === "estimated" && typeof revenue.employees === "number" ? `About ${revenue.employees} employees`
    : typeof revenue?.usdMillions === "number" ? `$${Number(revenue.usdMillions.toFixed(1))}M revenue${revenue.year ? ` (${revenue.year})` : ""}` : null;

  const [{ data: roleRows }, { data: touchRows }] = await Promise.all([
    db.from("job_postings").select("title").eq("account_id", card.account_id as string).eq("active", true).limit(12),
    db.from("touches").select("channel,sent_at,created_at,reply_at,reply_classification,bounced_at,body").eq("card_id", id as string).order("created_at"),
  ]);
  const touches = (touchRows ?? []) as Array<{ channel: string; sent_at: string | null; created_at: string; reply_at: string | null; reply_classification: string | null; bounced_at: string | null; body: string | null }>;
  const firstEmail = touches.find((touch) => touch.channel === "email" && touch.body);

  const brief = buildCallBrief({
    person: person ?? { full_name: "Unknown", title: "", email: null, linkedin_url: null },
    account: { name: account?.name ?? "the company", domain: account?.domain ?? "", vertical: account?.vertical ?? null, employees: account?.employee_range ?? null },
    whyNow: (card.why_now as string) ?? "",
    operatingNeed: signal?.raw?.operating_need ?? null,
    roles: (roleRows ?? []).map((r) => r.title as string).filter(Boolean),
    posts: [],
    emailSubject: (card.email_subject as string | null) ?? null,
    emailBody: firstEmail?.body ?? (card.email_body as string | null) ?? null,
    meetingAt: (card.meeting_at as string | null) ?? null,
    history: touches.map((t) => ({ channel: t.channel, at: t.sent_at ?? t.created_at, replied: Boolean(t.reply_at), replyClass: t.reply_classification, bounced: Boolean(t.bounced_at) })),
    research: row ? {
      sector: row.sector ?? null, sizeLabel, workflow: row.reframe ?? null, trigger: row.trigger ?? null, limitations: row.limitations ?? [],
      reasons: row.aiFit && !row.aiFit.disqualified ? row.aiFit.reasons.map((reason) => ({ text: reason.text, url: reason.url })) : [],
    } : null,
  });

  const listHref = `/outreach?list=${card.assigned_to as string}&card=${card.id as string}`;
  const plain = [
    `Call brief: ${brief.who}, ${brief.role}, ${brief.company}`,
    brief.status,
    brief.facts.length ? brief.facts.join(" · ") : "",
    "", "Why them:", ...brief.why.map((item) => `- ${item.text}${item.url ? ` (${item.url})` : ""}`),
    brief.workflow ? `\nThe idea we pitched: ${brief.workflow}` : "",
    "", "Questions to ask:", ...brief.discovery.map((q, i) => `${i + 1}. ${q}`),
    "", "How to talk about Nine-67:", ...brief.talkingPoints.map((t) => `- ${t}`),
    "", "What we don't know yet:", ...brief.unknowns.map((u) => `- ${u}`),
  ].filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n");

  return <div className="shell">
    <main className="pipeline pipeline-work">
      <div className="call-brief">
        <div className="brief-head">
          <div><span className="overview-kick">Call brief</span><h1>{brief.who}</h1><p>{brief.role} · {brief.company}</p></div>
          <div className="brief-head-right">
            <BriefActions text={plain} />
          </div>
        </div>

        <p className={`brief-status ${brief.meetingAt ? "is-meeting" : ""}`}>{brief.status}</p>

        <nav className="brief-links" aria-label="Reach them">
          {person?.email && <a className="btn primary" href={`mailto:${person.email}`}>Email {person.email}</a>}
          {person?.linkedin_url && <a className="btn" href={person.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a>}
          {account?.domain && <a className="btn" href={`https://${account.domain}`} target="_blank" rel="noreferrer">{account.domain} ↗</a>}
          <Link className="btn ghost" href={listHref}>Open on the Reach-out list</Link>
          {account?.domain && <Link className="btn ghost" href={`/accounts/${account.domain}`}>Company details</Link>}
        </nav>

        {brief.facts.length > 0 && <div className="brief-facts">{brief.facts.map((f, i) => <span key={i}>{f}</span>)}</div>}

        <div className="brief-grid">
          <section className="brief-block">
            <h2>Why them</h2>
            {brief.why.length
              ? <ul className="brief-list">{brief.why.map((item, i) => <li key={i}>{item.text}{item.url && <> <a href={item.url} target="_blank" rel="noreferrer" className="brief-source">source ↗</a></>}</li>)}</ul>
              : <p className="brief-muted">No research on file for this company.</p>}
            {brief.workflow && <p className="brief-build"><b>The idea we pitched:</b> {brief.workflow}</p>}
          </section>
          <section className="brief-block">
            <h2>What we don&rsquo;t know yet</h2>
            <ul className="brief-list">{brief.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul>
          </section>
        </div>

        <div className="brief-grid">
          <section className="brief-block">
            <h2>Questions to ask</h2>
            <ol className="brief-list">{brief.discovery.map((q, i) => <li key={i}>{q}</li>)}</ol>
          </section>
          <section className="brief-block">
            <h2>How to talk about Nine-67</h2>
            <ul className="brief-list">{brief.talkingPoints.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </section>
        </div>

        {(brief.sentSubject || brief.sentBody) && (
          <section className="brief-block">
            <h2>{firstEmail ? "The email we sent" : "The email drafted for them"}</h2>
            {brief.sentSubject && <p className="brief-subject">{brief.sentSubject}</p>}
            {brief.sentBody && <p className="brief-email">{brief.sentBody}</p>}
          </section>
        )}

        {brief.history.length > 0 && (
          <section className="brief-block">
            <h2>History</h2>
            <ul className="brief-list">{brief.history.map((h, i) => <li key={i}>{h.label}, {new Date(h.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}: {h.outcome}</li>)}</ul>
          </section>
        )}
      </div>
    </main>
  </div>;
}
