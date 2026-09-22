import { cronAuthorized } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { sendEmail } from "@/lib/gmail";
import { validateEmail } from "@/lib/send-action";
import { dailyCap, sendDayStart } from "@/lib/send-guards";
import { emailHtml, fromHeader, sanitizeLinks, senderProfile, withSignature } from "@/lib/sender";
import { outboundBaseUrl } from "@/lib/urls";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

export const maxDuration=300;
// A claim this old belongs to a run that died; 15 minutes is comfortably past maxDuration (5) so a live
// run is never overtaken.
const STALE_CLAIM_MS=15*60*1000;
const daysBetween=(iso:string|null|undefined)=>(iso?Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/86_400_000)):0);
type Recipient={id:string;full_name:string;email:string|null;email_status:string;do_not_contact:boolean};
type DueStep={id:string;cadence_id:string;channel:string;kind:string;subject:string|null;body:string|null;cadences:{id:string;status:string;owner:Owner;rules:{stop_on_reply?:boolean};card_id:string;person_id:string;people:Recipient|null;cards:{person_id:string;assigned_to:Owner;people:Recipient;accounts:{status:string}}}};

export async function GET(request:Request){
  if(!cronAuthorized(request))return Response.json({error:"Unauthorized"},{status:401});
  const db=admin(),now=new Date(),{data,error}=await db.from("cadence_steps").select("id,cadence_id,channel,kind,subject,body,cadences(id,status,owner,rules,card_id,person_id,people(id,full_name,email,email_status,do_not_contact),cards(person_id,assigned_to,people(id,full_name,email,email_status,do_not_contact),accounts(status)))").eq("status","pending").lte("scheduled_at",now.toISOString()).order("scheduled_at").limit(25);
  if(error)return Response.json({error:error.message},{status:500});
  let sent=0,ready=0,stopped=0,failed=0,skipped=0;
  // At most one email per cadence per run: if the cron lapsed and day 3 + 7 + 14 are all due, sending them
  // back-to-back reads as a bot. Fire the earliest due step now; the rest stay pending for the next run.
  const firedThisRun=new Set<string>();
  for(const raw of data??[]){
    const step=raw as unknown as DueStep,cadence=step.cadences,card=cadence.cards;
    // The cadence records WHO the first email went to, and the follow-up bodies were written with that
    // person's first name in them. Reading the recipient off the card instead sent "Hi <colleague>" to the
    // card's primary contact — a different human — and stamped the primary's unsubscribe token on it.
    const to=cadence.people??card.people;
    try{
      // A paused cadence is a temporary hold: leave its steps pending so they resume when it reactivates.
      // Only a terminally non-active cadence (stopped/completed) skips its steps for good.
      if(cadence.status==="paused")continue;
      if(firedThisRun.has(cadence.id))continue; // already sent one step for this cadence in this run
      if(cadence.status!=="active"){await db.from("cadence_steps").update({status:"skipped"}).eq("id",step.id);skipped++;continue}
      if(cadence.rules?.stop_on_reply){const {count}=await db.from("touches").select("*",{count:"exact",head:true}).eq("card_id",cadence.card_id).neq("reply_classification","none");if((count??0)>0){await stopCadence(db,cadence.id);stopped++;continue}}
      // Manual reminders (LinkedIn, or steps explicitly flagged for review) surface as "ready" for the human.
      if(step.kind==="review"||step.channel!=="email"){await db.from("cadence_steps").update({status:"ready"}).eq("id",step.id);ready++;continue}
      // They've become off-limits — stop touching them (skip, don't fail).
      if(to.do_not_contact||["client","do_not_contact"].includes(card.accounts.status)){await db.from("cadence_steps").update({status:"skipped"}).eq("id",step.id);skipped++;continue}
      const {data:connection}=await db.from("gmail_connections").select("email,connected_at,created_at").eq("owner",cadence.owner).maybeSingle();
      // Can't auto-send yet (unverified recipient, missing pieces, or Gmail not connected for this seat)
      // → leave the sender a manual "ready" reminder instead of a hard failure.
      if(!to.email||to.email_status!=="verified"||!step.subject||!step.body||!connection){await db.from("cadence_steps").update({status:"ready"}).eq("id",step.id);ready++;continue}
      const dayStart=sendDayStart(now); // the operator's midnight, matching the manual send route
      // Only touches that actually left through Gmail count toward the cap (matches the manual send route);
      // a "Copy" touch carries no thread id and must not stall the cadence.
      const {count}=await db.from("touches").select("*",{count:"exact",head:true}).eq("sent_by",cadence.owner).eq("channel","email").not("gmail_thread_id","is",null).gte("sent_at",dayStart.toISOString());
      // Warmup ramp + daily cap: defer to a later run (stays pending) when the seat's cap is reached.
      const cap=dailyCap(daysBetween(connection.connected_at??connection.created_at));
      if((count??0)>=cap)continue;
      // Validate the sanitized body that actually ships, not the raw draft — link-count and content
      // guards must reflect the real payload after fabricated/foreign links are stripped.
      const cleanBody=sanitizeLinks(step.body);
      validateEmail(to.email_status,count??0,cleanBody,cap);
      // Atomically claim the step by stamping sent_at while it's still pending+unclaimed, so two
      // overlapping runs (or a retry) can't both send it — only the update that matches wins.
      // A claim older than STALE_CLAIM_MS can be taken again: if the function died between the claim and
      // the send (or between the send and the status write), the step kept status "pending" with sent_at
      // set, which `sent_at is null` could never match again — the step was picked up every run, re-validated,
      // and silently dropped forever. The window is well past maxDuration, so a run still in flight can't be
      // double-claimed. Postgres serialises the row, so the loser of a race matches zero rows.
      const staleBefore=new Date(now.getTime()-STALE_CLAIM_MS).toISOString();
      const {data:claimed}=await db.from("cadence_steps").update({sent_at:now.toISOString()}).eq("id",step.id).eq("status","pending").or(`sent_at.is.null,sent_at.lt.${staleBefore}`).select("id");
      if(!claimed||!claimed.length)continue;
      const {data:previous}=await db.from("touches").select("gmail_thread_id").eq("card_id",cadence.card_id).eq("person_id",to.id).eq("channel","email").not("gmail_thread_id","is",null).order("sent_at",{ascending:false}).limit(1).maybeSingle();
      const profile=await senderProfile(db,cadence.owner);
      const optOut=process.env.OPT_OUT_LINE??"If this isn't relevant, reply no and I won't follow up.",fullBody=`${withSignature(cleanBody,profile,connection.email)}\n\n${optOut}`;
      const html=emailHtml(cleanBody,profile,connection.email,optOut);
      const base=outboundBaseUrl(request);
      const unsubscribe=`${base}/api/unsubscribe?t=${encodeURIComponent(encrypt(to.id))}`;
      // Multipart: plain-text part for deliverability + HTML part carrying the branded signature; unsubscribe header too.
      const result=await sendEmail(cadence.owner,fromHeader(profile,connection.email),to.email,step.subject,fullBody,previous?.gmail_thread_id??undefined,profile.cc,html,unsubscribe);
      firedThisRun.add(cadence.id);
      await db.from("touches").insert({card_id:cadence.card_id,person_id:to.id,channel:"email",sent_at:now.toISOString(),sent_by:cadence.owner,gmail_thread_id:result.threadId,body:fullBody});
      await db.from("cadence_steps").update({status:"sent",sent_at:now.toISOString(),error:null}).eq("id",step.id);await db.from("cards").update({status:"sent"}).eq("id",cadence.card_id);sent++;
    }catch(cause){await db.from("cadence_steps").update({status:"failed",error:cause instanceof Error?cause.message:"Step failed"}).eq("id",step.id);failed++}
  }
  return Response.json({processed:data?.length??0,sent,ready,stopped,failed,skipped});
}

async function stopCadence(db:ReturnType<typeof admin>,id:string){await db.from("cadences").update({status:"stopped",completed_at:new Date().toISOString()}).eq("id",id);await db.from("cadence_steps").update({status:"skipped"}).eq("cadence_id",id).eq("status","pending")}
