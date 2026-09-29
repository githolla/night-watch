import { requireUser } from '@/lib/auth';
import { admin } from '@/lib/supabase/admin';
import { ownerAccessToken } from '@/lib/gmail';
import { recoveryDetails, recoveryReady, type RecoveryRecord } from '@/lib/delivery-recovery';
import { deliveryReservationId } from '@/lib/delivery-state';
import { QUOTA_GOAL } from '@/lib/mailbox-quota';
import { ensureFollowupCadence } from '@/lib/followups';
import { z } from 'zod';
export const maxDuration=60;
export async function GET() {
 try {
  const user=await requireUser(); const db=admin();
  const {data,error}=await db.from('message_experiments').select('id,card_id,person_id,owner,context,created_at,updated_at,status,people(full_name,email),cards(accounts(name)),message_variants(id,subject,body)').eq('owner',user.owner).eq('model','saved-email-v1').eq('status','selected').neq('goal',QUOTA_GOAL).order('created_at',{ascending:true}).limit(1000);
  if(error)throw new Error('Could not load delivery attempts. Try again.');
  const {data:steps,error:stepsError}=await db.from('cadence_steps').select('id,title,step_number,sent_at,subject,body,status,cadences!inner(owner,card_id,person_id,people(full_name,email),cards(accounts(name)))').eq('cadences.owner',user.owner).in('status',['pending','ready','failed']).not('sent_at','is',null).limit(500);
  if(stepsError)throw new Error('Could not load held follow-ups. Try again.');
  const ids=(steps??[]).map(step=>{const cadence=step.cadences as unknown as {person_id:string;card_id:string};return deliveryReservationId(step.title==='Intro email'&&step.step_number===1?cadence.card_id:`cadence:${step.id}`,cadence.person_id)});
  const known=ids.length?await db.from('message_experiments').select('id').in('id',ids):{data:[],error:null};
  if(known.error)throw new Error('Could not check held follow-up reservations.');
  const existing=new Set((known.data??[]).map(row=>row.id));
  const legacy=(steps??[]).flatMap(step=>{const cadence=step.cadences as unknown as {person_id:string;card_id:string;people:unknown;cards:unknown};return existing.has(deliveryReservationId(step.title==='Intro email'&&step.step_number===1?cadence.card_id:`cadence:${step.id}`,cadence.person_id))?[]:[{id:step.id,card_id:cadence.card_id,created_at:step.sent_at,ready:recoveryReady(step.sent_at),people:cadence.people,cards:cadence.cards,message_variants:[{subject:step.subject}],details:{kind:'followup',legacy:true}}]});
  return Response.json({attempts:[...(data??[]).filter(row=>recoveryDetails(row)).map(row=>({...row,details:recoveryDetails(row),ready:recoveryReady(row.created_at)})),...legacy]},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Could not load attempts'},{status:400});}
}
const input=z.object({id:z.string().uuid(),action:z.enum(['check','release','confirmSent']),confirmedNotSent:z.boolean().optional(),confirmedSent:z.boolean().optional()});
export async function POST(request:Request) {
 try {
  const user=await requireUser();const payload=input.parse(await request.json());const db=admin();
  const {data:row,error}=await db.from('message_experiments').select('*,people(full_name,email),cards(accounts(name)),message_variants(id,subject,body)').eq('id',payload.id).eq('owner',user.owner).eq('status','selected').single();
  if(error||!row)return await recoverLegacy(db,user.owner,payload);
  const details=recoveryDetails(row as RecoveryRecord);if(!details)throw new Error('This is not a reserved send.');
  if(!recoveryReady(row.created_at))throw new Error('Wait ten minutes after the attempt so an in-flight send can finish before checking or releasing it.');
  const token=await ownerAccessToken(user.owner);
  const q=`in:sent rfc822msgid:${row.id}@night-watch.nine-67.com`;
  const response=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=2`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Could not check Gmail Sent. The reservation is still held.');
  const found=await response.json() as {messages?:Array<{id:string;threadId:string}>};
  if(found.messages?.length){
    if(found.messages.length!==1)throw new Error('More than one matching message exists. Review Gmail Sent before resolving this attempt.');
    const receipt=found.messages[0];const variant=row.message_variants?.[0];
    const {data:logged,error:loggedError}=await db.from('touches').select('id').eq('experiment_variant_id',variant?.id??row.id).eq('sent_by',user.owner).limit(1).maybeSingle();
    if(loggedError)throw new Error('Could not check existing History. Nothing was changed.');
    const {error:touchError}=await db.from('touches').upsert({id:logged?.id??row.id,card_id:row.card_id,person_id:row.person_id,channel:'email',sent_by:user.owner,sent_at:row.created_at,gmail_thread_id:receipt.threadId,body:variant?.body??'',experiment_variant_id:variant?.id??null},{onConflict:'id'});
    if(touchError)throw new Error('Gmail confirms delivery, but History could not be repaired. Do not resend; retry this check.');
    const update=details.kind==='followup' ? db.from('cadence_steps').update({status:'sent',error:null,sent_at:row.created_at}).eq('id',details.stepId!) : db.from('cards').update({status:'sent'}).eq('id',row.card_id).in('status',['new','edited','approved','archived']);
    const {error:statusError}=await update;if(statusError)throw new Error('Gmail confirms delivery, but status could not be repaired. Do not resend; retry this check.');
    if(details.initialReservation) {
      const {error:cardError}=await db.from('cards').update({status:'sent'}).eq('id',row.card_id).in('status',['new','edited','approved','archived']);
      if(cardError)throw new Error('Gmail confirmed the scheduled introduction, but card status needs another check. Do not resend.');
    }
    if(details.kind==='initial')await ensureFollowupCadence(db,{cardId:row.card_id,personId:row.person_id,owner:user.owner,touchedChannel:'email',firstName:row.people?.full_name?.split(/\s+/)[0]??'there',company:row.cards?.accounts?.name??'',baseSubject:variant?.subject??''});
    const {error:receiptError}=await db.from('message_experiments').update({status:'sent',context:JSON.stringify({delivery:{...details,state:'sent',...receipt}})}).eq('id',row.id);
    if(receiptError)throw new Error('Delivery confirmed, but its receipt still needs saving. Retry this check; do not resend.');
    return Response.json({ok:true,resolved:true,message:'Gmail confirmed this message. History and delivery status are repaired. No email was sent by this check.'});
  }
  if(payload.action==='check')return Response.json({ok:true,notFound:true,message:'No matching message ID found. Check Gmail Sent manually for this recipient and subject, including older attempts without a message ID. Absence from search alone does not prove non-delivery.'});
  if(payload.action!=='release'||!payload.confirmedNotSent)throw new Error('Confirm you checked Gmail Sent and this message was not delivered.');
  // Keep the message reservation until all cleanup is complete. A concurrent sender
  // cannot take a fresh reservation that our cleanup would accidentally delete.
  if(details.kind==='followup'){
    const {error:stepError}=await db.from('cadence_steps').update({status:'ready',sent_at:null,error:null}).eq('id',details.stepId!);
    if(stepError)throw new Error('Could not release the follow-up. Its reservation remains held; retry this check.');
  }
  const {error:quotaError}=await db.from('message_experiments').delete().eq('owner',user.owner).eq('goal',QUOTA_GOAL).eq('context',JSON.stringify({reservationId:row.id}));
  if(quotaError)throw new Error('Could not release daily capacity. The message reservation remains held; retry this check.');
  const {error:releaseError,data:released}=await db.from('message_experiments').delete().eq('id',row.id).eq('owner',user.owner).eq('status','selected').eq('updated_at',row.updated_at).select('id');
  if(releaseError||!released?.length)throw new Error('The attempt changed or could not be released. Refresh and check again.');
  return Response.json({ok:true,resolved:true,message:'Reservation released after your confirmation. You can return to the draft and choose Send. No email was sent by this action.'});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Could not reconcile delivery'},{status:400});}
}


async function recoverLegacy(db:ReturnType<typeof admin>,owner:'josh'|'jenna',payload:z.infer<typeof input>) {
 const {data:step,error}=await db.from('cadence_steps').select('id,title,step_number,status,sent_at,subject,body,cadences!inner(owner,card_id,person_id,people(email))').eq('id',payload.id).eq('cadences.owner',owner).in('status',['pending','ready','failed']).not('sent_at','is',null).maybeSingle();
 if(error||!step)throw new Error('This attempt is unavailable or already resolved. Refresh the list.');
 const cadence=step.cadences as unknown as {owner:'josh'|'jenna';card_id:string;person_id:string;people:{email:string}};
 const reservationId=deliveryReservationId(step.title==='Intro email'&&step.step_number===1?cadence.card_id:`cadence:${step.id}`,cadence.person_id);
 const {data:reserved,error:reservationError}=await db.from('message_experiments').select('id').eq('id',reservationId).maybeSingle();
 if(reservationError||reserved)throw new Error('A protected attempt exists for this follow-up. Refresh the recovery list.');
 if(!recoveryReady(step.sent_at)||!cadence.people?.email||!step.subject)throw new Error('This older attempt cannot be checked yet. Verify its recipient and subject first.');
 const token=await ownerAccessToken(owner), after=Math.floor(Date.parse(step.sent_at)/1000)-300;
 const safe=(v:string)=>v.replace(/["\\]/g,' ');
 const q=`in:sent to:${safe(cadence.people.email)} subject:"${safe(step.subject)}" after:${after}`;
 const response=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=10`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('Could not check Gmail Sent. This follow-up remains held.');
 const found=await response.json() as {messages?:Array<{id:string;threadId:string}>};
 if(found.messages?.length) {
   if(payload.action!=='confirmSent')return Response.json({ok:true,legacyFound:true,message:'Potential sent message found for this older follow-up. Inspect Gmail Sent for the recipient, subject and attempt time. Confirm only if this follow-up was delivered.'});
   if(!payload.confirmedSent||found.messages.length!==1)throw new Error('Confirm the single matching message in Gmail Sent. Multiple matches need a manual history review.');
   const receipt=found.messages[0];
   const {data:logged,error:loggedError}=await db.from('touches').select('id').eq('card_id',cadence.card_id).eq('person_id',cadence.person_id).eq('sent_by',owner).eq('gmail_thread_id',receipt.threadId).gte('sent_at',new Date(Date.parse(step.sent_at)-300000).toISOString()).limit(1).maybeSingle();
   if(loggedError)throw new Error('Could not check History. The follow-up remains held.');
   const {error:touchError}=await db.from('touches').upsert({id:logged?.id??reservationId,card_id:cadence.card_id,person_id:cadence.person_id,sent_by:owner,channel:'email',sent_at:step.sent_at,gmail_thread_id:receipt.threadId,body:step.body},{onConflict:'id'});
   if(touchError)throw new Error('Could not repair History. Do not resend; retry this check.');
   const {error:stepError}=await db.from('cadence_steps').update({status:'sent',error:null}).eq('id',step.id).eq('sent_at',step.sent_at);
   if(stepError)throw new Error('History repaired, but status needs another check. Do not resend.');
   return Response.json({ok:true,resolved:true,message:'Follow-up marked sent after your confirmation. No email was sent by this action.'});
 }
 if(payload.action==='check')return Response.json({ok:true,notFound:true,message:'No matching message found. This older attempt has no unique message ID. Check the sender’s Gmail Sent manually before confirming it was not sent.'});
 if(payload.action!=='release'||!payload.confirmedNotSent)throw new Error('Confirm you checked Gmail Sent and this follow-up was not sent.');
 const {data:released,error:releaseError}=await db.from('cadence_steps').update({status:'ready',sent_at:null,error:null}).eq('id',step.id).eq('sent_at',step.sent_at).in('status',['pending','ready','failed']).select('id');
 if(releaseError||!released?.length)throw new Error('This attempt changed. Refresh and check again.');
 return Response.json({ok:true,resolved:true,message:'Older follow-up released for manual review. No email was sent.'});
}
