import { cronAuthorized } from "@/lib/auth";
import { classifyReply } from "@/lib/agents";
import { thread } from "@/lib/gmail";
import { createInvite, matchProposedSlot, type Slot } from "@/lib/calendar";
import { admin } from "@/lib/supabase/admin";
import { daysAgoIso } from "@/lib/time";
import type { Owner } from "@/lib/types";

export const maxDuration=300;
const decode=(data?:string)=>data?Buffer.from(data,"base64url").toString("utf8"):"";
// The email address inside a "Name <addr>" (or bare) From header, lowercased.
const fromAddress=(headers:Array<{name:string;value:string}>)=>{const v=headers.find(h=>h.name.toLowerCase()==="from")?.value??"";const m=v.match(/<([^>]+)>/);return (m?m[1]:v).trim().toLowerCase()};

/** When a prospect replies picking one of the times we proposed, book the invite automatically. Best-effort. */
async function autoBook(db: ReturnType<typeof admin>, cardId: string, owner: Owner, reply: string) {
  const { data: card } = await db.from("cards").select("proposed_times,invite_link,people(full_name,email),accounts(name)").eq("id", cardId).single();
  if (!card || card.invite_link) return null;
  const proposed = card.proposed_times as { timeZone: string; slots: Slot[] } | null;
  const person = card.people as unknown as { full_name: string; email: string | null } | null;
  const account = card.accounts as unknown as { name: string } | null;
  if (!proposed?.slots?.length || !person?.email) return null;
  const slot = matchProposedSlot(reply, proposed.slots);
  if (!slot) return null;
  try {
    const invite = await createInvite(owner, { summary: `Nine-67 × ${account?.name ?? person.full_name}`, description: "Intro call booked from your reply.", start: slot.start, end: slot.end, timeZone: proposed.timeZone, attendee: person.email });
    await db.from("cards").update({ invite_link: invite.htmlLink ?? invite.meetLink ?? "booked", meeting_at: slot.start, status: "meeting" }).eq("id", cardId);
    return invite;
  } catch { return null; }
}

export async function GET(request:Request){
  if(!cronAuthorized(request))return Response.json({error:"Unauthorized"},{status:401});
  const db=admin();
  // Which mailbox each seat sends from, so we never count our own thread messages as a reply.
  const {data:connRows}=await db.from("gmail_connections").select("owner,email");
  const seatEmail=new Map<string,string>();for(const r of (connRows??[]) as Array<{owner:string;email:string|null}>)if(r.email)seatEmail.set(r.owner,r.email.trim().toLowerCase());
  // Only poll recent outbound (last 21 days) and cap the batch, so this stays bounded as volume grows.
  const {data:touches}=await db.from("touches").select("id,card_id,sent_by,gmail_thread_id,sent_at,experiment_variant_id").eq("channel","email").not("gmail_thread_id","is",null).is("reply_at",null).gte("sent_at",daysAgoIso(21)).order("sent_at",{ascending:false}).limit(300);
  let replies=0;
  for(const touch of touches??[]){
    try{
      const value=await thread(touch.sent_by,touch.gmail_thread_id), our=seatEmail.get(touch.sent_by);
      // A genuine reply is a thread message AFTER our send that is NOT from our own seat address
      // (a later message from us — a follow-up on the same thread — must never be scored as a reply).
      const messages=value.messages.filter(message=>Number(message.internalDate)>new Date(touch.sent_at).getTime()&&(!our||fromAddress(message.payload.headers)!==our));
      if(!messages.length)continue;
      const latest=messages.at(-1)!,body=decode(latest.payload.body?.data)||decode(latest.payload.parts?.find(part=>part.mimeType==="text/plain")?.body.data),classification=await classifyReply(body),replyAt=new Date(Number(latest.internalDate)).toISOString();
      await db.from("touches").update({reply_at:replyAt,reply_classification:classification}).eq("id",touch.id);
      await db.from("cards").update({status:classification==="positive"?"positive":"replied"}).eq("id",touch.card_id);
      // If they picked one of the times we proposed, book the calendar invite automatically (sets status to "meeting").
      if(classification==="positive")await autoBook(db,touch.card_id,touch.sent_by as Owner,body);
      if(touch.experiment_variant_id){const {data:variant}=await db.from("message_variants").select("experiment_id").eq("id",touch.experiment_variant_id).maybeSingle();if(variant)await db.from("message_experiments").update({status:"completed"}).eq("id",variant.experiment_id)}
      const {data:cadence}=await db.from("cadences").select("id").eq("card_id",touch.card_id).eq("status","active").maybeSingle();
      if(cadence){await db.from("cadences").update({status:"stopped",completed_at:replyAt}).eq("id",cadence.id);await db.from("cadence_steps").update({status:"skipped"}).eq("cadence_id",cadence.id).eq("status","pending")}
      replies++;
    }catch{}
  }
  return Response.json({replies});
}
