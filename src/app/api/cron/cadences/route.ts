import { cronAuthorized } from "@/lib/auth";
import { sendEmail } from "@/lib/gmail";
import { validateEmail } from "@/lib/send-action";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

export const maxDuration=300;
type DueStep={id:string;cadence_id:string;channel:string;kind:string;subject:string|null;body:string|null;cadences:{id:string;status:string;owner:Owner;rules:{stop_on_reply?:boolean};card_id:string;cards:{person_id:string;assigned_to:Owner;people:{email:string|null;email_status:string;do_not_contact:boolean};accounts:{status:string}}}};

export async function GET(request:Request){
  if(!cronAuthorized(request))return Response.json({error:"Unauthorized"},{status:401});
  const db=admin(),now=new Date(),{data,error}=await db.from("cadence_steps").select("id,cadence_id,channel,kind,subject,body,cadences(id,status,owner,rules,card_id,cards(person_id,assigned_to,people(email,email_status,do_not_contact),accounts(status)))").eq("status","pending").lte("scheduled_at",now.toISOString()).order("scheduled_at").limit(25);
  if(error)return Response.json({error:error.message},{status:500});
  let sent=0,ready=0,stopped=0,failed=0;
  for(const raw of data??[]){
    const step=raw as unknown as DueStep,cadence=step.cadences,card=cadence.cards;
    try{
      if(cadence.status!=="active"){await db.from("cadence_steps").update({status:"skipped"}).eq("id",step.id);continue}
      if(cadence.rules?.stop_on_reply){const {count}=await db.from("touches").select("*",{count:"exact",head:true}).eq("card_id",cadence.card_id).neq("reply_classification","none");if((count??0)>0){await stopCadence(db,cadence.id);stopped++;continue}}
      if(step.kind==="review"||step.channel!=="email"){await db.from("cadence_steps").update({status:"ready"}).eq("id",step.id);ready++;continue}
      if(card.people.do_not_contact||["client","do_not_contact"].includes(card.accounts.status))throw new Error("Do-not-contact guard blocked this step");
      if(!card.people.email||!step.subject||!step.body)throw new Error("Automatic email is missing a verified recipient or message");
      const dayStart=new Date(now);dayStart.setHours(0,0,0,0);
      const {count}=await db.from("touches").select("*",{count:"exact",head:true}).eq("sent_by",cadence.owner).eq("channel","email").gte("sent_at",dayStart.toISOString());
      validateEmail(card.people.email_status,count??0,step.body);
      const {data:connection}=await db.from("gmail_connections").select("email").eq("owner",cadence.owner).single();if(!connection)throw new Error("Gmail is not connected");
      const {data:previous}=await db.from("touches").select("gmail_thread_id").eq("card_id",cadence.card_id).eq("channel","email").not("gmail_thread_id","is",null).order("sent_at",{ascending:false}).limit(1).maybeSingle();
      const optOut=process.env.OPT_OUT_LINE??"If this isn't relevant, reply no and I won't follow up.",fullBody=`${step.body.trim()}\n\n${optOut}`;
      const result=await sendEmail(cadence.owner,connection.email,card.people.email,step.subject,fullBody,previous?.gmail_thread_id??undefined);
      await db.from("touches").insert({card_id:cadence.card_id,person_id:card.person_id,channel:"email",sent_at:now.toISOString(),sent_by:cadence.owner,gmail_thread_id:result.threadId,body:fullBody});
      await db.from("cadence_steps").update({status:"sent",sent_at:now.toISOString(),error:null}).eq("id",step.id);await db.from("cards").update({status:"sent"}).eq("id",cadence.card_id);sent++;
    }catch(cause){await db.from("cadence_steps").update({status:"failed",error:cause instanceof Error?cause.message:"Step failed"}).eq("id",step.id);failed++}
  }
  return Response.json({processed:data?.length??0,sent,ready,stopped,failed});
}

async function stopCadence(db:ReturnType<typeof admin>,id:string){await db.from("cadences").update({status:"stopped",completed_at:new Date().toISOString()}).eq("id",id);await db.from("cadence_steps").update({status:"skipped"}).eq("cadence_id",id).eq("status","pending")}
