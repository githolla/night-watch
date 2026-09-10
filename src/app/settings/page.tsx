import { Header } from "@/components/Header";
import { FeatureControlCenter } from "@/components/FeatureControlCenter";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { targetAccounts } from "@/lib/target-accounts";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Settings() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const db = admin();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: connections }, { count: accountCount }, { count: cardsToday }, { count: experiments }, { count: outcomes }] = await Promise.all([
    db.from("gmail_connections").select("owner,email"),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").in("domain", targetAccounts.map(account => account.domain)),
    db.from("cards").select("*", { count: "exact", head: true }).eq("surfaced_on", today),
    db.from("message_experiments").select("*", { count: "exact", head: true }),
    db.from("touches").select("*", { count: "exact", head: true }).not("reply_at", "is", null),
  ]);
  const slackConnected = Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET && process.env.SLACK_CHANNEL_ID);
  return <div>
    <Header />
    <main className="workspace-page"><FeatureControlCenter targetCount={accountCount ?? 0} slackConnected={slackConnected} slackChannelId={process.env.SLACK_CHANNEL_ID ?? ""} gmailConnections={connections ?? []} cardsToday={cardsToday ?? 0} experiments={experiments ?? 0} outcomes={outcomes ?? 0} /></main>
  </div>;
}
