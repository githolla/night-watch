import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { FeatureControlCenter } from "@/components/FeatureControlCenter";
import { Connections } from "@/components/Connections";
import { Users } from "@/components/Users";
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
    db.from("sender_profiles").select("from_name,title,signature,cc").eq("owner", "josh").maybeSingle(),
  ]);
  const senderEmail = (connections ?? []).find((row) => row.owner === "josh")?.email ?? (connections ?? [])[0]?.email ?? null;
  const senderProfile = {
    from_name: (sender?.from_name as string | null) ?? "",
    title: (sender?.title as string | null) ?? "",
    signature: (sender?.signature as string | null) ?? "",
    cc: Array.isArray(sender?.cc) ? (sender!.cc as string[]) : [],
  };
  const slackConnected = Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET && process.env.SLACK_CHANNEL_ID);
  return <div>
    <Header />
    <main className="workspace-page">
      {me.role === "admin" && <div className="feature-center" style={{ marginBottom: 18 }}><Users /></div>}
      <div className="feature-center" style={{ marginBottom: 18 }}><Connections connections={connections ?? []} /></div>
      <div className="feature-center" style={{ marginBottom: 18 }}><SenderProfileForm initial={senderProfile} senderEmail={senderEmail} /></div>
      <FeatureControlCenter targetCount={accountCount ?? 0} targetTotal={activeTargetAccounts.length} slackConnected={slackConnected} slackChannelId={process.env.SLACK_CHANNEL_ID ?? ""} gmailConnections={connections ?? []} cardsToday={cardsToday ?? 0} experiments={experiments ?? 0} outcomes={outcomes ?? 0} />
    </main>
  </div>;
}
