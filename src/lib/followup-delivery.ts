import { authoredSenderDraft } from './authored-sender';
import { firstTouchErrors } from './first-touch';
import { refreshLegacyFollowup } from './followups';
import { withMailboxQuota } from './mailbox-quota';
import { DeliveryError, deliveryReservationId } from './delivery-state';
import { trackEmailVersion } from './version-tracking';
import { sendEmail, thread } from './gmail';
import { validateEmail } from './send-action';
import { dailyCap, sendDayStart } from './send-guards';
import { fromHeader, sanitizeLinks, senderProfile } from './sender';
import { outreachDelivery } from './outreach-ending';
import type { admin } from './supabase/admin';
import type { AppUser } from './users';
import type { Owner } from './types';

type Db = ReturnType<typeof admin>;
export const followupSelect = 'id,title,step_number,status,sent_at,kind,channel,subject,body,cadence_id,cadences!inner(id,status,owner,card_id,person_id,people(id,full_name,email,email_status,do_not_contact),cards(accounts(status,name,domain)))';
type Step = { id:string; title:string; step_number:number; status:string; sent_at:string|null; kind:string; channel:string; subject:string|null; body:string|null; cadence_id:string; cadences: { id:string; status:string; owner:Owner; card_id:string; person_id:string; people:{id:string; full_name:string; email:string|null; email_status:string; do_not_contact:boolean}|null; cards:{accounts:{status:string;name:string;domain:string}|null}|null }|null };
export function assertFollowupOwner(owner: Owner, viewer: Owner) {
  if (owner !== viewer) throw new Error(`Sign in as ${owner === 'jenna' ? 'Suuchi' : 'Josh'} to send this follow-up. Shared viewing does not change the sender.`);
}
export function hasInboundReply(messages: Array<{internalDate:string;payload:{headers:Array<{name:string;value:string}>}}>, sentAt:string, ours:string[]) {
  const addresses = new Set(ours.map(s => s.trim().toLowerCase()));
  return messages.some(m => {
    const raw = m.payload.headers.find(h => h.name.toLowerCase() === 'from')?.value ?? '';
    const address = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim().toLowerCase();
    return Number(m.internalDate) > Date.parse(sentAt) && Boolean(address) && !addresses.has(address);
  });
}
export async function sendFollowup(db: Db, raw: unknown, viewer?: Owner, actor?: AppUser['actor']) {
  const step = raw as Step, cadence = step.cadences, to = cadence?.people;
  if (!cadence || !to) throw new Error('This follow-up has no contact attached.');
  if (viewer) assertFollowupOwner(cadence.owner, viewer);
  if (!['pending','ready','failed'].includes(step.status) || cadence.status !== 'active') throw new Error('This follow-up is no longer ready to send.');
  // Never reclaim an old transport claim. It may have reached Gmail before the process stopped.
  if (step.sent_at) throw new DeliveryError('delivery_reserved', 'This follow-up needs delivery confirmation. Check Gmail Sent before taking further action.');
  if (step.channel !== 'email' || !step.subject || !step.body || !to.email) throw new Error('An email address, subject and message are required.');
  if (to.do_not_contact || ['client','do_not_contact'].includes(cadence.cards?.accounts?.status ?? '')) throw new Error('Do-not-contact guard blocked this follow-up.');
  const {data:connection,error:connectionError} = await db.from('gmail_connections').select('email,connected_at,created_at').eq('owner',cadence.owner).maybeSingle();
  if (connectionError || !connection?.email) throw new Error('Connect the sender’s Gmail in Settings before sending.');
  const {count,error:countError} = await db.from('touches').select('*',{count:'exact',head:true}).eq('sent_by',cadence.owner).eq('channel','email').not('gmail_thread_id','is',null).gte('sent_at',sendDayStart().toISOString());
  if (countError || count === null) throw new Error('Could not check the daily sending limit. Nothing was sent.');
  const days = Math.max(0,Math.floor((Date.now()-Date.parse(connection.connected_at ?? connection.created_at))/86400000));
  let body = sanitizeLinks(refreshLegacyFollowup(step.body,{firstName:to.full_name.split(/\s+/)[0],company:cadence.cards?.accounts?.name??'your team',baseSubject:step.subject,step:step.step_number,channel:'email'})).replace(/[—–]/g, ',');
  validateEmail(to.email_status,count,body,dailyCap(days),!viewer);
  const {data:previous,error:historyError} = await db.from('touches').select('gmail_thread_id,sent_at').eq('card_id',cadence.card_id).eq('person_id',to.id).eq('sent_by',cadence.owner).eq('channel','email').not('gmail_thread_id','is',null).order('sent_at',{ascending:true}).limit(1).maybeSingle();
  const scheduledInitial = step.step_number === 1 && step.title === 'Intro email';
  if (historyError || (!previous && !scheduledInitial)) throw new Error('Could not confirm the original conversation. Review History before sending.');
  if (scheduledInitial && previous) throw new Error('The initial email is already in History. Review the sequence instead of sending another introduction.');
  const profile = await senderProfile(db,cadence.owner);
  if (scheduledInitial) {
    const authored = authoredSenderDraft({body:step.body,domain:cadence.cards?.accounts?.domain,contactName:to.full_name,senderName:profile.fromName,greeting:profile.greeting});
    if (authored.senderConflict) throw new Error(authored.senderConflict);
    const errors = firstTouchErrors(step.subject,authored.body);
    if (errors.length) throw new Error(errors.join(' '));
    body = sanitizeLinks(authored.body);
  }
  if (previous) {
  // Stored reply status can lag the cron. Read the actual conversation immediately before reserving.
  const {data:connections,error:connectionsError} = await db.from('gmail_connections').select('email');
  if (connectionsError) throw new Error('Could not check for replies. Nothing was sent.');
  const conversation = await thread(cadence.owner,previous.gmail_thread_id);
  if (!Array.isArray(conversation.messages)) throw new Error('Could not check for replies. Nothing was sent.');
  if (hasInboundReply(conversation.messages,previous.sent_at,(connections ?? []).map(c => c.email))) {
    const {error} = await db.from('cadences').update({status:'stopped',completed_at:new Date().toISOString()}).eq('id',cadence.id);
    if (error) throw new Error('A reply was found. Could not save the stopped sequence; nothing was sent.');
    await db.from('cadence_steps').update({status:'skipped',error:'Recipient replied; sequence stopped.'}).eq('cadence_id',cadence.id).in('status',['pending','ready','failed']);
    return {ok:true,stopped:true,to:to.full_name};
  }
  }
  const delivery = outreachDelivery(body,profile);
  const subject = step.subject, recipientEmail = to.email;
  const reservationId = deliveryReservationId(scheduledInitial ? cadence.card_id : `cadence:${step.id}`,to.id);
  const sent = await withMailboxQuota(db,{owner:cadence.owner,cardId:cadence.card_id,personId:to.id,count,cap:dailyCap(days),dayStart:sendDayStart(),reservationId},async () => {
  const versionId = await trackEmailVersion(db,{actor,cardId:cadence.card_id,personId:to.id,owner:cadence.owner,subject,body:delivery.text,source:'gmail',followup:!scheduledInitial,reservationId,reservationContext:{kind:"followup",stepId:step.id,initialReservation:scheduledInitial}});
  const release = async () => { await db.from('message_experiments').delete().eq('id',reservationId); };
  const {data:claimed,error:claimError} = await db.from('cadence_steps').update({sent_at:new Date().toISOString(),error:'Delivery in progress. Check Sent before retrying.'}).eq('id',step.id).in('status',['pending','ready','failed']).is('sent_at',null).select('id');
  if (claimError || !claimed?.length) { await release(); throw new Error('This follow-up changed before sending. Reload to see its status.'); }
  let result;
  try { result = await sendEmail(cadence.owner,fromHeader(profile,connection.email),recipientEmail,subject,delivery.text,previous?.gmail_thread_id,profile.cc,delivery.html,undefined,`${reservationId}@night-watch.nine-67.com`); }
  catch(error) {
    const unknown = error instanceof DeliveryError && error.code === 'delivery_unknown';
    if (!unknown) { await release(); await db.from('cadence_steps').update({sent_at:null,status:'failed',error:error instanceof Error?error.message:'Send failed before delivery.'}).eq('id',step.id); }
    else { try { await db.from('cadence_steps').update({status:'failed',error:'Delivery unknown. Check Gmail Sent; automatic retries are blocked.'}).eq('id',step.id); } catch { /* Preserve delivery_unknown so quota and message reservations remain held. */ } }
    throw error;
  }
  return {result,versionId};
  });
  const {result,versionId} = sent;
  let warning = '';
  try {
    const status = await db.from('cadence_steps').update({status:'sent',sent_at:new Date().toISOString(),error:null}).eq('id',step.id);
    const history = await db.from('touches').insert({id:reservationId,card_id:cadence.card_id,person_id:to.id,channel:'email',sent_at:new Date().toISOString(),sent_by:cadence.owner,gmail_thread_id:result.threadId,body:delivery.text,experiment_variant_id:versionId});
    const cardStatus = scheduledInitial ? await db.from('cards').update({status:'sent'}).eq('id',cadence.card_id).in('status',['new','edited','approved']) : {error:null};
    if (!status.error && !history.error && !cardStatus.error) {
      const receipt=await db.from('message_experiments').update({status:'sent',context:JSON.stringify({delivery:{kind:'followup',stepId:step.id,initialReservation:scheduledInitial,state:'sent',messageId:result.id,threadId:result.threadId}})}).eq('id',reservationId);
      if(receipt.error) warning='Gmail confirmed delivery, but its receipt needs recovery. Do not resend.';
    }
    if (status.error || history.error || cardStatus.error) warning = 'Gmail confirmed delivery, but history could not be fully saved. Do not resend; check Gmail Sent.';
  } catch { warning = 'Gmail confirmed delivery, but saving history was interrupted. Do not resend; check Gmail Sent.'; }
  return {ok:true,threadId:result.threadId,to:to.full_name,sentBy:cadence.owner,warning};
}
