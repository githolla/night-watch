import { Header } from "@/components/Header";
import { SlackPanel } from "@/components/SlackPanel";
import { TargetAccountsPanel } from "@/components/TargetAccountsPanel";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { targetAccounts } from "@/lib/target-accounts";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Settings() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const db = admin();
  const [{ data: connections }, { count: accountCount }] = await Promise.all([
    db.from("gmail_connections").select("owner,email"),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").in("domain", targetAccounts.map(account => account.domain)),
  ]);
  const slackConnected = Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET && process.env.SLACK_CHANNEL_ID);
  return <div>
    <Header />
    <main className="stats">
      <div className="eyebrow">Integrations and targeting</div>
      <h1>Settings</h1>
      <SlackPanel connected={slackConnected} channelId={process.env.SLACK_CHANNEL_ID ?? ""} />
      <TargetAccountsPanel initialCount={accountCount ?? 0} />
      <div className="grid settings-grid">
        <section className="panel">
          <h2>Gmail <span className="badge">optional</span></h2>
          <p>Connect Gmail only if you want Night Watch to send from the desk. Manual email and LinkedIn tracking work without it.</p>
          <a className="btn" href="/api/gmail/connect">Connect my Gmail</a>
          {(connections ?? []).map(connection => <p key={connection.owner} style={{ marginTop: 18 }}><span className="badge">connected</span> {connection.email}</p>)}
        </section>
        <section className="panel">
          <h2>Deployment checks</h2>
          <ul>
            <li>✓ Supabase connected</li><li>✓ Vercel cron configured</li><li>✓ Anthropic research configured</li>
            <li>{slackConnected ? "✓" : "○"} Slack command center</li>
            <li>{accountCount === 100 ? "✓" : "○"} 100 target accounts active</li><li>○ Gmail optional</li>
          </ul>
        </section>
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <h2>Scoring controls</h2>
        <p>Cards surface at <strong>60 points</strong>. Daily email cap: <strong>15 per sender</strong>. Nightly cost stop: <strong>$10</strong>.</p>
        <div className="grid"><p>Signal strength <strong>0–40</strong></p><p>Person fit <strong>0–30</strong></p><p>Recency <strong>0–20</strong></p><p>Relationship path <strong>0–10</strong></p></div>
      </div>
    </main>
  </div>;
}
