import { Desk, type EmptyDeskState } from "@/components/Desk";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { targetAccounts } from "@/lib/target-accounts";
import { redirect } from "next/navigation";
export const dynamic="force-dynamic";
type Params={card?:string;status?:string;priority?:string;source?:string};
export default async function DeskPage({searchParams}:{searchParams:Promise<Params>}){
  const params=await searchParams;
  if(!(process.env.NEXT_PUBLIC_SUPABASE_URL??process.env.SUPABASE_URL)||!(process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY))redirect("/setup");
  const user=await requireUser();
  const db=admin(),today=new Date().toISOString().slice(0,10),owner=user.email?.startsWith("jenna")?"jenna":"josh";
  let query=db.from("cards").select("*,accounts(*),people(*),signals(*)").eq("surfaced_on",today).order("score",{ascending:false});
  if(params.status)query=query.eq("status",params.status);
  if(params.priority==="high")query=query.gte("score",75);
  const [{data,error},{data:gmail},{count:activeAccounts},{count:researchedAccounts},{data:lastRun}]=await Promise.all([
    query,
    db.from("gmail_connections").select("id").eq("owner",owner).maybeSingle(),
    db.from("accounts").select("*",{count:"exact",head:true}).eq("status","active").not("domain","like","%.example"),
    db.from("accounts").select("*",{count:"exact",head:true}).eq("status","active").not("domain","like","%.example").not("last_scouted_at","is",null),
    db.from("runs").select("started_at,finished_at,accounts_scouted,signals_new,cards_created,errors").order("started_at",{ascending:false}).limit(1).maybeSingle(),
  ]);if(error)throw error;
  const suggestions=[...targetAccounts].filter(account=>account.aiSignal&&account.sourceUrl).sort((a,b)=>Number(Boolean(b.ceo))-Number(Boolean(a.ceo))||Number(b.ownership==="PE-backed")-Number(a.ownership==="PE-backed")||(b.revenueEstimateUsdM??0)-(a.revenueEstimateUsdM??0)).slice(0,6).map(account=>({name:account.name,domain:account.domain,aiSignal:account.aiSignal,sourceUrl:account.sourceUrl,buyerTitles:account.targetTitles}));
  const emptyState:EmptyDeskState={targetTotal:targetAccounts.length,activeAccounts:activeAccounts??0,researchedAccounts:researchedAccounts??0,suggestions,lastRun:lastRun?{status:lastRun.finished_at?"Complete":"Running",startedAt:new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(lastRun.started_at)),accounts:lastRun.accounts_scouted??0,signals:lastRun.signals_new??0,cards:lastRun.cards_created??0,errors:Array.isArray(lastRun.errors)?lastRun.errors.length:0}:null};
  return <div className="shell"><Header/><Desk initialCards={data??[]} selectedId={params.card} gmailConnected={Boolean(gmail)} emptyState={emptyState}/></div>;
}
