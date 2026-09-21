import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { FeatureControlCenter } from "@/components/FeatureControlCenter";
import { Connections } from "@/components/Connections";
import { Users } from "@/components/Users";
import { FeedbackAutomation } from "@/components/FeedbackAutomation";
import { RewriteDrafts } from "@/components/RewriteDrafts";
import { AddCompany } from "@/components/AddCompany";
import { SettingsTabs } from "@/components/SettingsTabs";
import { SenderProfileForm } from "@/components/SenderProfileForm";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { activeTargetAccounts } from "@/lib/target-accounts";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Settings() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  const me = await requireUser();
  {
    const pending = await pendingMigrations(admin());
    if (pending.length) return <MigrationRequired pending={pending} />;
  }
  const db = admin();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: connections }, { count: accountCount }, { count: cardsToday }, { count: experiments }, { count: outcomes }, { data: sender }] = await Promise.all([
    db.from("gmail_connections").select("owner,email,calendar,connected_at"),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("domain", "like", "%.example"),
    db.from("cards").select("*", { count: "exact", head: true }).eq("surfaced_on", today),
    db.from("message_experiments").select("*", { count: "exact", head: true }),
    db.from("touches").select("*", { count: "exact", head: true }).not("reply_at", "is", null),
    db.from("sender_profiles").select("from_name,title,signature,website,location,cc").eq("owner", me.owner).maybeSingle(),
  ]);
  const { count: feedbackCount } = me.role === "admin" ? await admin().from("feedback").select("*", { count: "exact", head: true }) : { count: 0 };
  const senderEmail = (connections ?? []).find((row) => row.owner === me.owner)?.email ?? me.email ?? null;
  const senderProfile = {
    from_name: (sender?.from_name as string | null) ?? "",
    title: (sender?.title as string | null) ?? "",
    signature: (sender?.signature as string | null) ?? "",
    website: (sender?.website as string | null) ?? "",
    location: (sender?.location as string | null) ?? "",
    cc: Array.isArray(sender?.cc) ? (sender!.cc as string[]) : [],
  };
  const slackConnected = Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET && process.env.SLACK_CHANNEL_ID);
  const googleConfig = {
    clientId: Boolean(process.env.GOOGLE_CLIENT_ID),
    clientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? null,
    appUrl: process.env.APP_URL ?? null,
  };
  const isAdmin = me.role === "admin";
  // Is this seat actually able to send, and does it read as a person? These drive the "start here" chip, so
  // a half-set-up app points at its own gap instead of leaving the user to guess.
  const mailboxConnected = (connections ?? []).some((row) => row.owner === me.owner);
  const identitySet = Boolean(senderProfile.from_name.trim());
  const sendingReady = mailboxConnected && identitySet;
  const { count: teamCount } = isAdmin ? await db.from("app_users").select("*", { count: "exact", head: true }) : { count: 0 };

  // One section per job, each saying what it is and whether it still needs doing.
  const tabs = [
    {
      id: "sending", label: "Sending & identity",
      summary: "The mailbox you send from, and the name and signature on every email",
      blurb: sendingReady
        ? `Emails go out from ${senderEmail ?? "the connected mailbox"} as “${senderProfile.from_name}”. Change the mailbox, the name and title on the From line, who gets CC'd, or the signature appended to every send.`
        : "Start here — nothing can send until a Google account is connected. Connect the mailbox Night Watch should send from, then set the name and title that appear on the From line and the signature appended to every email.",
      status: sendingReady
        ? { tone: "ok" as const, label: "Ready" }
        : { tone: "todo" as const, label: mailboxConnected ? "Add your name" : "Start here" },
      content: <>
        <div className="feature-center" style={{ marginBottom: 18 }}><Connections connections={connections ?? []} google={googleConfig} /></div>
        <div className="feature-center"><SenderProfileForm initial={senderProfile} senderEmail={senderEmail} /></div>
      </>,
    },
    ...(isAdmin ? [{
      id: "companies", label: "Companies",
      summary: "Add a company to the reach-out list, or take one off",
      blurb: "The list is imported from the target file and kept in step automatically. Use this to add a company by hand, or to take one off when the pitch doesn't apply — an AI product company that already builds this itself, for example. Anything you change by hand is respected; the nightly import won't undo it.",
      status: { tone: "info" as const, label: `${accountCount ?? 0} active` },
      content: <div className="feature-center"><AddCompany /></div>,
    }] : []),
    ...(isAdmin ? [{
      id: "drafts", label: "Draft quality",
      summary: "Fix or rewrite every un-sent email at once",
      blurb: "Bulk tools that act on every un-sent draft together. “Clean up all drafts” is instant and free — it removes repeated lines and stray links without rewording anything. “Rewrite all drafts” runs the writing model and costs money. Both leave every draft editable before you send it.",
      content: <div className="feature-center"><RewriteDrafts /></div>,
    }] : []),
    ...(isAdmin ? [{
      id: "team", label: "Team",
      summary: "Who can sign in, and which mailbox they send from",
      blurb: "Invite a teammate by email. They get their own sign-on and their own sending seat, so their emails go out from their mailbox with their signature, not yours.",
      status: { tone: "info" as const, label: `${teamCount ?? 0} ${teamCount === 1 ? "person" : "people"}` },
      content: <div className="feature-center"><Users /></div>,
    }] : []),
    ...(isAdmin ? [{
      id: "feedback", label: "Feedback",
      summary: "What testers have reported from inside the app",
      blurb: "Every “Feedback” submission from across the app, with who sent it and which page they were on. Download it as a spreadsheet, or have it posted to GitHub automatically each night.",
      status: { tone: "info" as const, label: `${feedbackCount ?? 0} on file` },
      content: <>
        <div className="feature-center" style={{ marginBottom: 18 }}>
          <section className="conn-card">
            <header className="conn-head"><div><h2>Tester feedback</h2><p>Every &ldquo;Feedback&rdquo; submission across the app, timestamped with who sent it and which page. {feedbackCount ?? 0} on file.</p></div></header>
            <a className="btn primary" href="/api/feedback/export">Download CSV</a>
          </section>
        </div>
        <div className="feature-center"><FeedbackAutomation /></div>
      </>,
    }] : []),
    {
      id: "system", label: "System",
      summary: "Run status, Slack and the target list — mostly read-only",
      blurb: "How the nightly run is doing, whether Slack is wired up, and how much of the target list has been researched. You shouldn't need anything here day to day — it's for checking that the machinery behind the desk is running.",
      content:
        <FeatureControlCenter targetCount={accountCount ?? 0} targetTotal={activeTargetAccounts.length} slackConnected={slackConnected} slackChannelId={process.env.SLACK_CHANNEL_ID ?? ""} gmailConnections={connections ?? []} cardsToday={cardsToday ?? 0} experiments={experiments ?? 0} outcomes={outcomes ?? 0} />,
    },
  ];
  return <div>
    <Header />
    <main className="workspace-page">
      <SettingsTabs tabs={tabs} />
    </main>
  </div>;
}
