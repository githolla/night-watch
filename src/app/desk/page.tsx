import { Desk } from "@/components/Desk";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { demoCards } from "@/lib/demo";
import { admin } from "@/lib/supabase/admin";
export const dynamic="force-dynamic";
type Params={card?:string;status?:string;priority?:string;source?:string};
export default async function DeskPage({searchParams}:{searchParams:Promise<Params>}){
  const params=await searchParams,demo=!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(demo){
    let cards=demoCards;
    if(params.status)cards=cards.filter(c=>c.status===params.status);
    if(params.priority==="high")cards=cards.filter(c=>c.score>=75);
    const source=params.source;
    if(source){const map:Record<string,string[]>={jobs:["job_post","job_cluster"],posts:["exec_post"],news:["new_leader","funding","stack_change"],events:["event"]};cards=cards.filter(c=>map[source]?.includes(c.signals.type))}
    return <div className="shell"><Header/><div className="demo-banner">Demo mode · sample data · no messages can be sent</div><Desk initialCards={cards} selectedId={params.card} demo/></div>;
  }
  const user=await requireUser();
  const db=admin(),today=new Date().toISOString().slice(0,10),owner=user.email?.startsWith("jenna")?"jenna":"josh";
  let query=db.from("cards").select("*,accounts(*),people(*),signals(*)").eq("surfaced_on",today).order("score",{ascending:false});
  if(params.status)query=query.eq("status",params.status);
  if(params.priority==="high")query=query.gte("score",75);
  const [{data,error},{data:gmail}]=await Promise.all([query,db.from("gmail_connections").select("id").eq("owner",owner).maybeSingle()]);if(error)throw error;
  return <div className="shell"><Header/><Desk initialCards={data??[]} selectedId={params.card} gmailConnected={Boolean(gmail)}/></div>;
}
