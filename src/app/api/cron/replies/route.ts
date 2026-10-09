import { processReplyEvent } from "@/lib/reply-event";
import { isBounce, markTouchBounced, prioritizeThreads } from "@/lib/bounce";
import { isOptOutReply, optOutPerson } from "@/lib/email-suppression";
import { cronAuthorized } from "@/lib/auth";
import { classifyReply } from "@/lib/agents";
import { thread } from "@/lib/gmail";
import { createInvite, matchProposedSlot, type Slot } from "@/lib/calendar";
import { sendReplySlack } from "@/lib/slack";
import { sendReplyAlert } from "@/lib/seat-notices";
import { admin } from "@/lib/supabase/admin";
import { daysAgoIso } from "@/lib/time";
import type { Owner } from "@/lib/types";

export const maxDuration=300;
const decode=(data?:string)=>data?Buffer.from(data,"base64url").toString("utf8"):"";
// The email address inside a "Name <addr>" (or bare) From header, lowercased.
const fromAddress=(headers:Array<{name:string;value:string}>)=>{const v=headers.find(h=>h.name.toLowerCase()==="from")?.value??"";const m=v.match(/<([^>]+)>/);return (m?m[1]:v).trim().toLowerCase()};

/** When a prospect replies picking one of the times we proposed, book the invite automatically. Best-effort. */
async function autoBook(db: ReturnType<typeof admin>, cardId: string, owner: Owner, reply: string, personId: string) {
  const { data: card, error: cardError } = await db.from("cards").select("proposed_times,invite_link,people(full_name,email),accounts(name)").eq("id", cardId).single();
  if(cardError)throw new Error("Could not load meeting state.");
  if (!card || card.invite_link) return null;
  const proposed = card.proposed_times as { timeZone: string; slots: Slot[] } | null;
  const {data:person,error:personError}=await db.from("people").select("full_name,email").eq("id",personId).single();
  if(personError)throw new Error("Could not load reply contact.");
  const account = card.accounts as unknown as { name: string } | null;
  if (!proposed?.slots?.length || !person?.email) return null;
  const slot = matchProposedSlot(reply, proposed.slots);
  if (!slot) return null;
  {
    const invite = await createInvite(owner, { summary: `Nine-67 × ${account?.name ?? person.full_name}`, description: "Intro call booked from your reply.", start: slot.start, end: slot.end, timeZone: proposed.timeZone, attendee: person.email, bookingKey: `${cardId}:${slot.start}` });
    const saved=await db.from("cards").update({ invite_link: invite.htmlLink ?? invite.meetLink ?? "booked", meeting_at: slot.start, status: "meeting" }).eq("id", cardId);
    if(saved.error)throw new Error("Could not save the calendar receipt.");
    return invite;
  }
}

export async function GET(request:Request){
  if(!cronAuthorized(request))return Response.json({error:"Unauthorized"},{status:401});
  const db=admin(),deadline=Date.now()+240000;
  // Every mailbox we send from (across both seats), so no message we sent — first touch OR a later
  // follow-up on the same thread — is ever mis-scored as an inbound reply.
  const {data:connRows,error:connectionError}=await db.from("gmail_connections").select("owner,email");
  if(connectionError)return Response.json({error:"Could not read connected mailboxes"},{status:503});
  const ourEmails=new Set<string>();for(const r of (connRows??[]) as Array<{owner:string;email:string|null}>)if(r.email)ourEmails.add(r.email.trim().toLowerCase());
  // Only poll recent outbound (last 21 days) and cap the batch, so this stays bounded as volume grows.
  // Read recent history in pages, deduplicate before selecting a rotating window. Every thread
  // gets a turn instead of older unreplied touches consuming the same 300 slots indefinitely.
  const candidates: Array<{id:string;card_id:string;sent_by:Owner;gmail_thread_id:string;sent_at:string;person_id:string;reply_at:string|null}> = [];
  for(let offset=0;offset<10000;offset+=1000) {
    const {data,error}=await db.from("touches").select("id,card_id,person_id,sent_by,gmail_thread_id,sent_at,reply_at").eq("channel","email").not("gmail_thread_id","is",null).gte("sent_at",daysAgoIso(21)).order("sent_at",{ascending:true}).range(offset,offset+999);
    if(error)return Response.json({error:"Could not load reply history"},{status:503});
    candidates.push(...(data??[]) as typeof candidates);
    if((data?.length??0)<1000)break;
  }
  const unique=[...new Map([...candidates].reverse().map(t=>[`${t.sent_by}:${t.gmail_thread_id}`,t])).values()];
  // Threads sent in the last 48h go first so a new bounce reaches the auto-send brake within one run.
  const touches=prioritizeThreads(unique,Math.floor(Date.now()/(15*60*1000))*300,Date.now());
  let replies=0,bounces=0; const failures:Array<{cardId:string;error:string}>=[];
  // A card with a first touch + a follow-up has TWO unreplied touches on one thread; without this a real
  // reply would be handled once per touch — duplicate Slack posts and a card status written twice (which can
  // stomp a just-booked meeting back to "positive"). Handle each thread at most once per run.
  const seenThreads=new Set<string>();
  for(const touch of touches??[]){
    if(Date.now()>deadline)break;
    if(seenThreads.has(`${touch.sent_by}:${touch.gmail_thread_id}`))continue;
    seenThreads.add(`${touch.sent_by}:${touch.gmail_thread_id}`);
    try{
      const value=await thread(touch.sent_by,touch.gmail_thread_id);
      // A genuine reply is a thread message AFTER our send that is NOT from one of our own seat mailboxes.
      const inbound=value.messages.filter(message=>Number(message.internalDate)>new Date(touch.sent_at).getTime()&&!ourEmails.has(fromAddress(message.payload.headers)));
      if(inbound.some(message=>isBounce(message.payload.headers))){await markTouchBounced(db,touch);bounces++;}
      const messages=inbound.filter(message=>!isBounce(message.payload.headers));
      if(!messages.length)continue;
      seenThreads.add(`${touch.sent_by}:${touch.gmail_thread_id}`);
      for(const message of [...messages].sort((a,b)=>Number(a.internalDate)-Number(b.internalDate))){
        if(!message.id)throw new Error('Gmail reply is missing its message ID.');
        const body=messageText(message.payload),replyAt=new Date(Number(message.internalDate)).toISOString();
        const completed=await processReplyEvent(db,{owner:touch.sent_by,cardId:touch.card_id,personId:touch.person_id,messageId:message.id,alreadyHandled:Boolean(touch.reply_at&&Date.parse(touch.reply_at)>=Number(message.internalDate))},[
          async()=>({classification:await classifyReply(body)}),
          async(state)=>{
            // Replaying effects is safe; never demote a meeting or later pipeline stage.
            const card=await db.from('cards').update({status:state.classification==='positive'||state.classification==='referral'?'positive':'replied'}).eq('id',touch.card_id).in('status',['new','edited','approved','sent','positive','replied']);
            if(card.error)throw new Error('Could not update the replied card.');
            const {data:cadence,error}=await db.from('cadences').select('id').eq('card_id',touch.card_id).maybeSingle();
            if(error)throw new Error('Could not load the reply sequence.');
            if(cadence){
              const stopped=await db.from('cadences').update({status:'stopped',completed_at:replyAt}).eq('id',cadence.id).in('status',['active','paused']);
              if(stopped.error)throw new Error('Could not stop the reply sequence.');
              const skipped=await db.from('cadence_steps').update({status:'skipped'}).eq('cadence_id',cadence.id).in('status',['pending','ready','failed']).is('sent_at',null);
              if(skipped.error)throw new Error('Could not close unsent sequence steps.');
            }
            const history=await db.from('touches').update({reply_at:replyAt,reply_classification:state.classification}).eq('gmail_thread_id',touch.gmail_thread_id).eq('sent_by',touch.sent_by).lte('sent_at',replyAt);
            if(history.error)throw new Error('Could not save reply history.');
            // "No thanks" opts the address out everywhere: every row with it, every card's sequence.
            if(isOptOutReply(body,state.classification))await optOutPerson(db,touch.person_id);
          },
          async(state)=>{
            try{return {booked:state.classification==='positive'?Boolean(await autoBook(db,touch.card_id,touch.sent_by,body,touch.person_id)):false};}
            catch(error){return {booked:false,bookingError:error instanceof Error?error.message:'Scheduling needs review'};}
          },
          async(state,eventId)=>{
            const {data:person,error}=await db.from('people').select('full_name,title,accounts(name)').eq('id',touch.person_id).single();
            if(error||!person)throw new Error('Could not load reply notification contact.');
            const account=person.accounts as unknown as {name:string}|null;
            const result=await sendReplySlack({cardId:touch.card_id,name:person.full_name,company:account?.name??'',title:person.title,classification:state.booked?'meeting':state.classification!,body:state.bookingError?`${body}\n\nScheduling needs review: ${state.bookingError}`:body,booked:state.booked,eventId});
            if(!result.delivered&&result.reason!=='Slack is not configured')throw new Error(result.reason??'Reply notification failed.');
          },
          async(state)=>{
            // An email to the seat's own inbox. Its own step, so it goes once; it never throws, so a missed alert cannot stall the reply.
            const {data:person}=await db.from('people').select('full_name,title,accounts(name)').eq('id',touch.person_id).maybeSingle();
            await sendReplyAlert(db,{owner:touch.sent_by,cardId:touch.card_id,name:person?.full_name??'Someone',title:(person?.title as string|null)??null,company:(person?.accounts as unknown as {name:string}|null)?.name??'',classification:state.booked?'meeting':state.classification!,body});
          }
        ]);
        if(completed==='busy')break;
        if(completed)replies++;
      }
    }catch(error){failures.push({cardId:touch.card_id,error:error instanceof Error?error.message:'Reply check failed'});}
  }
  return Response.json({checked:touches.length,replies,bounces,failed:failures.length,failures},{status:failures.length?503:200});
}

function messageText(payload:{mimeType?:string;body?:{data?:string};parts?:unknown[]}):string{
 if(payload.mimeType==='text/plain'&&payload.body?.data)return decode(payload.body.data);
 const parts=(payload.parts??[]) as Array<Parameters<typeof messageText>[0]>;
 const plain=parts.filter(p=>p.mimeType==='text/plain'||p.parts?.length).map(messageText).filter(Boolean).join('\n');
 if(plain)return plain;
 return (decode(payload.body?.data)||parts.map(p=>decode(p.body?.data)).join('\n')).replace(/<[^>]*>/g,' ');
}
