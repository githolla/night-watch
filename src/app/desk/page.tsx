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
  const [{data,error},{data:gmail},{count:activeAccounts},{count:researchedAccounts},{data:lastRun},{data:recentSignalRows},{data:recentScanRows}]=await Promise.all([
    query,
    db.from("gmail_connections").select("id").eq("owner",owner).maybeSingle(),
    db.from("accounts").select("*",{count:"exact",head:true}).eq("status","active").not("domain","like","%.example"),
    db.from("accounts").select("*",{count:"exact",head:true}).eq("status","active").not("domain","like","%.example").not("last_scouted_at","is",null),
    db.from("runs").select("started_at,finished_at,accounts_scouted,signals_new,cards_created,errors").order("started_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("signals").select("type,summary,source_url,observed_at,raw,accounts(name,domain),people(full_name,title)").order("found_at",{ascending:false}).limit(8),
    db.from("accounts").select("name,domain,last_scouted_at").not("domain","like","%.example").not("last_scouted_at","is",null).order("last_scouted_at",{ascending:false}).limit(10),
  ]);if(error)throw error;
  const recentSignals=(recentSignalRows??[]).map(signal=>{const raw=(signal.raw??{}) as {post?:{text?:string;author_name?:string;author_title?:string;published_at?:string};source?:{excerpt?:string;author_name?:string|null;published_at?:string}},account=signal.accounts as unknown as {name:string;domain:string},person=signal.people as unknown as {full_name:string;title:string}|null;return {company:account.name,domain:account.domain,type:signal.type,summary:signal.summary,sourceUrl:signal.source_url,observedAt:signal.observed_at,authorName:raw.post?.author_name??raw.source?.author_name??person?.full_name??null,authorTitle:raw.post?.author_title??person?.title??null,sourceText:raw.post?.text??raw.source?.excerpt??signal.summary,publishedAt:raw.post?.published_at??raw.source?.published_at??signal.observed_at,isPost:Boolean(raw.post)}});
  const recentScans=(recentScanRows??[]).map(account=>({name:account.name,domain:account.domain,lastScoutedAt:account.last_scouted_at!}));
  const emptyState:EmptyDeskState={targetTotal:targetAccounts.length,activeAccounts:activeAccounts??0,researchedAccounts:researchedAccounts??0,recentSignals,recentScans,lastRun:lastRun?{status:lastRun.finished_at?"Complete":"Running",startedAt:new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(lastRun.started_at)),accounts:lastRun.accounts_scouted??0,signals:lastRun.signals_new??0,cards:lastRun.cards_created??0,errors:Array.isArray(lastRun.errors)?lastRun.errors.length:0}:null};
  return <div className="shell"><Header/><Desk initialCards={data??[]} selectedId={params.card} gmailConnected={Boolean(gmail)} emptyState={emptyState}/></div>;
}
