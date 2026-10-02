import { cronAuthorized } from '@/lib/auth';
import { admin } from '@/lib/supabase/admin';
import { followupSelect, sendFollowup } from '@/lib/followup-delivery';
import { followupHoldReason } from '@/lib/morning-send-rules';
export const maxDuration=300;
export async function GET(request:Request) {
  if (!cronAuthorized(request)) return Response.json({error:'Unauthorized'},{status:401});
  const db=admin();
  const {data,error}=await db.from('cadence_steps').select(followupSelect).eq('status','pending').eq('cadences.status','active').lte('scheduled_at',new Date().toISOString()).order('scheduled_at').limit(25);
  if(error)return Response.json({error:error.message},{status:500});
  let sent=0,ready=0,failed=0,stopped=0,held=0;
  const seen=new Set<string>();
  // A paused seat (by hand or by the bounce brake), or one with no postal address, holds its automatic
  // follow-ups for a person. Looked up once per seat.
  const holds=new Map<string,Promise<string|null>>();
  const holdFor=(owner:string)=>{
    if(!holds.has(owner))holds.set(owner,(async()=>{
      const {data:profile,error:profileError}=await db.from('sender_profiles').select('*').eq('owner',owner).maybeSingle();
      if(profileError)return 'Could not read the seat settings, so this follow-up waits for a person.';
      return followupHoldReason({paused:Boolean(profile?.auto_send_paused),pausedReason:(profile?.auto_send_paused_reason as string|null|undefined)??null,postalAddress:((profile?.postal_address as string|null|undefined)??'')});
    })());
    return holds.get(owner)!;
  };
  for(const step of data??[]) {
    const cadence=step.cadences as unknown as {id:string;status:string;owner:string};
    if(!cadence || cadence.status!=='active' || seen.has(cadence.id))continue;
    seen.add(cadence.id);
    if(step.kind==='review'||step.channel!=='email') {await db.from('cadence_steps').update({status:'ready'}).eq('id',step.id);ready++;continue;}
    const hold=await holdFor(cadence.owner);
    if(hold) {await db.from('cadence_steps').update({status:'ready',error:hold}).eq('id',step.id).eq('status','pending');held++;continue;}
    try { const result=await sendFollowup(db,step);if(result.stopped)stopped++;else sent++; }
    catch(cause) {
      // Claims never expire into another send. Failed/blocked items remain visible for human recovery.
      await db.from('cadence_steps').update({status:'failed',error:cause instanceof Error?cause.message:'Follow-up blocked; review required.'}).eq('id',step.id).neq('status','sent');failed++;
    }
  }
  return Response.json({processed:data?.length??0,sent,ready,held,failed,stopped});
}
