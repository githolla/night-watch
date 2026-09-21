import { cronAuthorized } from "@/lib/auth";
import { classifyReply } from "@/lib/agents";
import { thread } from "@/lib/gmail";
import { createInvite, matchProposedSlot, type Slot } from "@/lib/calendar";
import { sendReplySlack } from "@/lib/slack";
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
  // Every mailbox we send from (across both seats), so no message we sent — first touch OR a later
  // follow-up on the same thread — is ever mis-scored as an inbound reply.
  const {data:connRows}=await db.from("gmail_connections").select("owner,email");
  const ourEmails=new Set<string>();for(const r of (connRows??[]) as Array<{owner:string;email:string|null}>)if(r.email)ourEmails.add(r.email.trim().toLowerCase());
  // Only poll recent outbound (last 21 days) and cap the batch, so this stays bounded as volume grows.
  const {data:touches}=await db.from("touches").select("id,card_id,sent_by,gmail_thread_id,sent_at,experiment_variant_id").eq("channel","email").not("gmail_thread_id","is",null).is("reply_at",null).gte("sent_at",daysAgoIso(21)).order("sent_at",{ascending:true}).limit(300);
  let replies=0;
  // A card with a first touch + a follow-up has TWO unreplied touches on one thread; without this a real
  // reply would be handled once per touch — duplicate Slack posts and a card status written twice (which can
  // stomp a just-booked meeting back to "positive"). Handle each thread at most once per run.
  const seenThreads=new Set<string>();
  for(const touch of touches??[]){
    if(seenThreads.has(touch.gmail_thread_id))continue;
    try{
      const value=await thread(touch.sent_by,touch.gmail_thread_id);
      // A genuine reply is a thread message AFTER our send that is NOT from one of our own seat mailboxes.
      const messages=value.messages.filter(message=>Number(message.internalDate)>new Date(touch.sent_at).getTime()&&!ourEmails.has(fromAddress(message.payload.headers)));
      if(!messages.length)continue;
      seenThreads.add(touch.gmail_thread_id);
      const latest=messages.at(-1)!,body=decode(latest.payload.body?.data)||decode(latest.payload.parts?.find(part=>part.mimeType==="text/plain")?.body.data),classification=await classifyReply(body),replyAt=new Date(Number(latest.internalDate)).toISOString();
      // Mark EVERY still-open touch on this thread replied, so sibling touches (a follow-up) aren't reprocessed next run.
      await db.from("touches").update({reply_at:replyAt,reply_classification:classification}).eq("gmail_thread_id",touch.gmail_thread_id).is("reply_at",null);
      await db.from("cards").update({status:classification==="positive"?"positive":"replied"}).eq("id",touch.card_id);
      // If they picked one of the times we proposed, book the calendar invite automatically (sets status to "meeting").
      const booked=classification==="positive"?Boolean(await autoBook(db,touch.card_id,touch.sent_by as Owner,body)):false;
      if(touch.experiment_variant_id){const {data:variant}=await db.from("message_variants").select("experiment_id").eq("id",touch.experiment_variant_id).maybeSingle();if(variant)await db.from("message_experiments").update({status:"completed"}).eq("id",variant.experiment_id)}
      const {data:cadence}=await db.from("cadences").select("id").eq("card_id",touch.card_id).eq("status","active").maybeSingle();
      if(cadence){await db.from("cadences").update({status:"stopped",completed_at:replyAt}).eq("id",cadence.id);await db.from("cadence_steps").update({status:"skipped"}).eq("cadence_id",cadence.id).eq("status","pending")}
      // Surface every inbound reply in Slack (who, classification, a snippet, a link to the dossier).
      const {data:info}=await db.from("cards").select("people(full_name,title),accounts(name)").eq("id",touch.card_id).maybeSingle();
      const person=info?.people as unknown as {full_name:string;title:string|null}|null;
      const account=info?.accounts as unknown as {name:string}|null;
      if(person)await sendReplySlack({cardId:touch.card_id,name:person.full_name,company:account?.name??"",title:person.title,classification:booked?"meeting":classification,body,booked});
      replies++;
    }catch{}
  }
  return Response.json({replies});
}
