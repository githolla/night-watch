import { Desk } from "@/components/Desk";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
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
  const [{data,error},{data:gmail}]=await Promise.all([query,db.from("gmail_connections").select("id").eq("owner",owner).maybeSingle()]);if(error)throw error;
  return <div className="shell"><Header/><Desk initialCards={data??[]} selectedId={params.card} gmailConnected={Boolean(gmail)}/></div>;
}
