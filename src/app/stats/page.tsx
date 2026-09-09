import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { demoStats } from "@/lib/demo";
import { admin } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
type StatsData = typeof demoStats;
function StatsView({stats,demo=false}:{stats:StatsData;demo?:boolean}) {
  return <div><Header/>{demo&&<div className="demo-banner">Demo mode · illustrative performance data</div>}<main className="stats"><div className="eyebrow">Learning view · last 30 runs</div><h1>Signal performance</h1><div className="metrics"><div className="metric">Approved sends<strong>{stats.sent}</strong></div><div className="metric">Reply rate<strong>{stats.replyRate}%</strong></div><div className="metric">Positive share<strong>{stats.positiveShare}%</strong></div><div className="metric">Meetings<strong>{stats.meetings}</strong></div></div><table><thead><tr><th>Signal type</th><th>Sends</th><th>Reply rate</th><th>Positive share</th></tr></thead><tbody>{stats.groups.map(g=><tr key={g.name}><td>{g.name}</td><td>{g.sent}</td><td>{g.replyRate}%</td><td>{g.positiveShare}%</td></tr>)}</tbody></table><p style={{marginTop:20}}>Estimated model spend: ${stats.cost.toFixed(2)}</p></main></div>;
}
export default async function Stats() {
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY) return <StatsView stats={demoStats} demo/>;
  await requireUser();
  const db=admin();
  const {data:touches}=await db.from("touches").select("reply_classification,channel,cards(signals(type),people(level))").eq("channel","email");
  const {count:meetings}=await db.from("cards").select("*",{count:"exact",head:true}).eq("status","meeting");
  const {data:runs}=await db.from("runs").select("cost_usd").order("started_at",{ascending:false}).limit(30);
  const sent=touches?.length??0,replied=touches?.filter(t=>t.reply_classification!=="none").length??0,positive=touches?.filter(t=>["positive","referral"].includes(t.reply_classification)).length??0;
  const groups=new Map<string,{sent:number;replies:number;positive:number}>();
  for(const t of touches??[]){const type=((t.cards as unknown as {signals:{type:string}})?.signals?.type)??"unknown",g=groups.get(type)??{sent:0,replies:0,positive:0};g.sent++;if(t.reply_classification!=="none")g.replies++;if(["positive","referral"].includes(t.reply_classification))g.positive++;groups.set(type,g)}
  return <StatsView stats={{sent,replyRate:sent?Math.round(replied/sent*100):0,positiveShare:replied?Math.round(positive/replied*100):0,meetings:meetings??0,cost:(runs??[]).reduce((n,r)=>n+Number(r.cost_usd),0),groups:[...groups].map(([name,g])=>({name:name.replaceAll("_"," "),sent:g.sent,replyRate:g.sent?Math.round(g.replies/g.sent*100):0,positiveShare:g.replies?Math.round(g.positive/g.replies*100):0}))}}/>;
}
