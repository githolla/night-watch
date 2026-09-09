import { cronAuthorized } from "@/lib/auth";
import { classifyReply } from "@/lib/agents";
import { thread } from "@/lib/gmail";
import { admin } from "@/lib/supabase/admin";

const decode=(data?:string)=>data?Buffer.from(data,"base64url").toString("utf8"):"";

export async function GET(request:Request){
  if(!cronAuthorized(request))return Response.json({error:"Unauthorized"},{status:401});
  const db=admin(),{data:touches}=await db.from("touches").select("id,card_id,sent_by,gmail_thread_id,sent_at").eq("channel","email").not("gmail_thread_id","is",null).is("reply_at",null);
  let replies=0;
  for(const touch of touches??[]){
    try{
      const value=await thread(touch.sent_by,touch.gmail_thread_id),messages=value.messages.filter(message=>Number(message.internalDate)>new Date(touch.sent_at).getTime());
      if(!messages.length)continue;
      const latest=messages.at(-1)!,body=decode(latest.payload.body?.data)||decode(latest.payload.parts?.find(part=>part.mimeType==="text/plain")?.body.data),classification=await classifyReply(body),replyAt=new Date(Number(latest.internalDate)).toISOString();
      await db.from("touches").update({reply_at:replyAt,reply_classification:classification}).eq("id",touch.id);
      await db.from("cards").update({status:classification==="positive"?"positive":"replied"}).eq("id",touch.card_id);
      const {data:cadence}=await db.from("cadences").select("id").eq("card_id",touch.card_id).eq("status","active").maybeSingle();
      if(cadence){await db.from("cadences").update({status:"stopped",completed_at:replyAt}).eq("id",cadence.id);await db.from("cadence_steps").update({status:"skipped"}).eq("cadence_id",cadence.id).eq("status","pending")}
      replies++;
    }catch{}
  }
  return Response.json({replies});
}
