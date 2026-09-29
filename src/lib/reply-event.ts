import type { SupabaseClient } from '@supabase/supabase-js';
import { deliveryReservationId } from './delivery-state.ts';
import type { Owner } from './types';
export const REPLY_MODEL='reply-event-v1';
type State={phase:number;leaseUntil:number;error?:string;classification?:string;booked?:boolean;bookingError?:string};
/** Durable per-message checkpoints; retries resume failed work without excluding the thread. */
export async function processReplyEvent(db:SupabaseClient,input:{owner:Owner;cardId:string;personId:string;messageId:string;alreadyHandled?:boolean}, actions:Array<(state:State,id:string)=>Promise<Partial<State>|void>>){
 const id=deliveryReservationId(`reply:${input.owner}:${input.messageId}`,input.cardId);
 const inserted=await db.from('message_experiments').insert({id,card_id:input.cardId,person_id:input.personId,owner:input.owner,channel:'email',goal:'Inbound reply processing',model:REPLY_MODEL,status:input.alreadyHandled?'completed':'selected',context:JSON.stringify({phase:0,leaseUntil:0,messageId:input.messageId})});
 if(inserted.error&&inserted.error.code!=='23505')throw new Error('Could not record inbound reply.');
 const {data:row,error}=await db.from('message_experiments').select('status,context,updated_at').eq('id',id).single();
 if(error||!row)throw new Error('Could not read inbound reply state.');
 if(row.status==='completed')return false;
 let state=JSON.parse(row.context) as State;
 if(state.leaseUntil>Date.now())return 'busy' as const;
 state={...state,leaseUntil:Date.now()+600000,error:undefined};
 const claim=await db.from('message_experiments').update({context:JSON.stringify(state)}).eq('id',id).eq('updated_at',row.updated_at).select('id');
 if(claim.error)throw new Error('Could not claim reply processing.');
 if(!claim.data?.length)return 'busy' as const;
 try{
  for(let i=state.phase;i<actions.length;i++){
   state={...state,...await actions[i](state,id),phase:i+1};
   const saved=await db.from('message_experiments').update({context:JSON.stringify(state)}).eq('id',id);
   if(saved.error)throw new Error('Could not checkpoint reply processing.');
  }
  const done=await db.from('message_experiments').update({status:'completed',context:JSON.stringify({...state,leaseUntil:0})}).eq('id',id);
  if(done.error)throw new Error('Could not complete reply processing.');
  return true;
 }catch(error){
  await db.from('message_experiments').update({context:JSON.stringify({...state,leaseUntil:0,error:error instanceof Error?error.message:'Reply processing failed'})}).eq('id',id);
  throw error;
 }
}
