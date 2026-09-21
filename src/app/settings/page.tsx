import Link from "next/link";
import { Building2, Mail, MessageSquare, PenLine, Plug, UsersRound } from "lucide-react";
import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { FeatureControlCenter } from "@/components/FeatureControlCenter";
import { Connections } from "@/components/Connections";
import { Users } from "@/components/Users";
import { FeedbackAutomation } from "@/components/FeedbackAutomation";
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

  // Compact sections. Counts live inside each page, not in the nav; a chip appears only where it carries
  // information. Target accounts and Draft tools have moved to the pages where that work happens — the
  // entries here are signposts to them, kept while people learn the new places.
  const tabs = [
    {
      id: "sending", label: "Email accounts", icon: <Mail />,
      blurb: sendingReady
        ? `Emails go out from ${senderEmail ?? "the connected mailbox"} as \u201C${senderProfile.from_name}\u201D. Change the mailbox, the name on the From line, who is copied, or the signature.`
        : "Connect the Google account Night Watch sends from, then set the name and signature every email goes out with.",
      status: sendingReady
        ? { tone: "ok" as const, label: "Connected" }
        : { tone: "todo" as const, label: mailboxConnected ? "Add name" : "Start here" },
      content: <>
        <div className="feature-center" style={{ marginBottom: 18 }}><Connections connections={connections ?? []} google={googleConfig} /></div>
        <div className="feature-center"><SenderProfileForm initial={senderProfile} senderEmail={senderEmail} /></div>
      </>,
    },
    ...(isAdmin ? [{
      id: "companies", label: "Target accounts", icon: <Building2 />,
      blurb: "Adding and excluding companies now lives with the company table, so it is where you are when you decide.",
      content: <div className="settings-moved">
        <p>This moved to <strong>All companies</strong>, where the full searchable table is. Use <strong>Add company</strong> there to add one by hand, or search and <strong>Exclude</strong> to take one off outreach.</p>
        <Link className="btn primary" href="/targets">Open All companies</Link>
      </div>,
    }] : []),
    ...(isAdmin ? [{
      id: "drafts", label: "Draft tools", icon: <PenLine />,
      blurb: "Bulk draft fixes now live on the desk, next to the drafts they change.",
      content: <div className="settings-moved">
        <p>This moved to <strong>Outreach</strong>, the desk where you work the drafts. Use <strong>Draft tools</strong> in the header there to clean up drafts, update the greeting, or regenerate them with AI.</p>
        <Link className="btn primary" href="/desk">Open Outreach</Link>
      </div>,
    }] : []),
    ...(isAdmin ? [{
      id: "team", label: "Team & access", icon: <UsersRound />,
      blurb: "Who can sign in, and which connected mailbox their outreach sends from.",
      content: <div className="feature-center"><Users /></div>,
    }] : []),
    ...(isAdmin ? [{
      id: "feedback", label: "Feedback inbox", icon: <MessageSquare />,
      blurb: "Everything testers have sent with the Feedback button, and where it goes next.",
      content: <>
        <div className="feature-center" style={{ marginBottom: 18 }}>
          <section className="conn-card">
            <header className="conn-head"><div><h2>Tester feedback</h2><p>{feedbackCount ?? 0} submission{feedbackCount === 1 ? "" : "s"}, each timestamped with who sent it and which page they were on.</p></div></header>
            <a className="btn primary" href="/api/feedback/export">Download CSV</a>
          </section>
        </div>
        <div className="feature-center"><FeedbackAutomation /></div>
      </>,
    }] : []),
    {
      id: "system", label: "Integrations & automation", icon: <Plug />,
      blurb: "Slack, the nightly run and the target list. Mostly read-only \u2014 for checking the machinery is running.",
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
