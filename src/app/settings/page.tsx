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
  // Grouped into tabs so Settings is one screen per concern instead of a single long scroll.
  const tabs = [
    {
      id: "sending", label: "Sending & identity", content: <>
        <div className="feature-center" style={{ marginBottom: 18 }}><Connections connections={connections ?? []} google={googleConfig} /></div>
        <div className="feature-center"><SenderProfileForm initial={senderProfile} senderEmail={senderEmail} /></div>
      </>,
    },
    ...(isAdmin ? [{ id: "companies", label: "Companies", content: <div className="feature-center"><AddCompany /></div> }] : []),
    ...(isAdmin ? [{ id: "drafts", label: "Draft quality", content: <div className="feature-center"><RewriteDrafts /></div> }] : []),
    ...(isAdmin ? [{ id: "team", label: "Team", content: <div className="feature-center"><Users /></div> }] : []),
    ...(isAdmin ? [{
      id: "feedback", label: "Feedback", content: <>
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
      id: "system", label: "System", content:
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
