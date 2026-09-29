import { cronAuthorized } from '@/lib/auth';
import { admin } from '@/lib/supabase/admin';
import { followupSelect, sendFollowup } from '@/lib/followup-delivery';
export const maxDuration=300;
export async function GET(request:Request) {
  if (!cronAuthorized(request)) return Response.json({error:'Unauthorized'},{status:401});
  const db=admin();
  const {data,error}=await db.from('cadence_steps').select(followupSelect).eq('status','pending').eq('cadences.status','active').lte('scheduled_at',new Date().toISOString()).order('scheduled_at').limit(25);
  if(error)return Response.json({error:error.message},{status:500});
  let sent=0,ready=0,failed=0,stopped=0;
  const seen=new Set<string>();
  for(const step of data??[]) {
    const cadence=step.cadences as unknown as {id:string;status:string};
    if(!cadence || cadence.status!=='active' || seen.has(cadence.id))continue;
    seen.add(cadence.id);
    if(step.kind==='review'||step.channel!=='email') {await db.from('cadence_steps').update({status:'ready'}).eq('id',step.id);ready++;continue;}
    try { const result=await sendFollowup(db,step);if(result.stopped)stopped++;else sent++; }
    catch(cause) {
      // Claims never expire into another send. Failed/blocked items remain visible for human recovery.
      await db.from('cadence_steps').update({status:'failed',error:cause instanceof Error?cause.message:'Follow-up blocked; review required.'}).eq('id',step.id).neq('status','sent');failed++;
    }
  }
  return Response.json({processed:data?.length??0,sent,ready,failed,stopped});
}
