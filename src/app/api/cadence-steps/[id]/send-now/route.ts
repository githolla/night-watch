import { requireUser } from '@/lib/auth';
import { admin } from '@/lib/supabase/admin';
import { deliveryErrorResponse } from '@/lib/delivery-state';
import { followupSelect, sendFollowup } from '@/lib/followup-delivery';
export async function POST(_request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const user = await requireUser(), {id} = await context.params, db = admin();
    const {data,error} = await db.from('cadence_steps').select(followupSelect).eq('id',id).maybeSingle();
    if (error || !data) throw new Error('Could not load this follow-up. Reload and try again.');
    return Response.json(await sendFollowup(db,data,user.owner));
  } catch(error) { return deliveryErrorResponse(error); }
}
