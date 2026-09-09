import { Desk } from "@/components/Desk";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { demoCards } from "@/lib/demo";
import { admin } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
export default async function Page() {
  const demo = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (demo) return <div className="shell"><Header/><div className="demo-banner">Demo mode · sample data · no messages can be sent</div><Desk initialCards={demoCards} demo/></div>;
  await requireUser();
  const today = new Date().toISOString().slice(0,10);
  const {data,error} = await admin().from("cards").select("*,accounts(*),people(*),signals(*)").eq("surfaced_on",today).in("status",["new","approved","edited","sent","replied","positive"]).order("score",{ascending:false});
  if(error) throw error;
  return <div className="shell"><Header/><Desk initialCards={data??[]}/></div>;
}
