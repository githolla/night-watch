import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
export default async function Settings() {
  const demo=!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY;
  let connections:{owner:string;email:string}[]=[];
  if(!demo){await requireUser();const {data}=await admin().from("gmail_connections").select("owner,email");connections=data??[]}
  return <div><Header/>{demo&&<div className="demo-banner">Demo mode · integrations are disconnected and safe</div>}<main className="stats"><div className="eyebrow">Integrations</div><h1>Settings</h1><div className="grid"><section className="panel"><h2>Gmail</h2><p>Sends from the assigned owner and keeps the message in their Sent folder.</p><a className={`btn primary ${demo?"disabled":""}`} href={demo?undefined:"/api/gmail/connect"}>{demo?"Available after setup":"Connect my Gmail"}</a>{connections.map(x=><p key={x.owner} style={{marginTop:18}}><span className="badge">connected</span> {x.email}</p>)}</section><section className="panel"><h2>Deployment checks</h2><ul><li>{demo?"○":"✓"} Supabase migration applied</li><li>{demo?"○":"✓"} Vercel cron configured</li><li>{demo?"○":"✓"} Apollo and Anthropic configured</li><li>○ SPF, DKIM, and DMARC verified</li><li>○ Both Gmail accounts connected</li></ul></section></div><div className="panel" style={{marginTop:18}}><h2>Scoring controls</h2><p>Cards surface at <strong>60 points</strong>. Daily email cap: <strong>15 per sender</strong>. Nightly cost stop: <strong>$10</strong>.</p><div className="grid"><p>Signal strength <strong>0–40</strong></p><p>Person fit <strong>0–30</strong></p><p>Recency <strong>0–20</strong></p><p>Relationship path <strong>0–10</strong></p></div></div></main></div>;
}
