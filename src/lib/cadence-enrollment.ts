import type { SupabaseClient } from '@supabase/supabase-js';
import type { Owner } from './types';
type Step={step_number:number;channel:string;kind:string;title:string;detail:string;subject?:string|null;body?:string|null;status:string;scheduled_at:string};
export class CadenceExists extends Error{}
/** Draft sequences cannot send. Save the intended steps before creating children so retries resume them. */
export async function enrollCadence(db:SupabaseClient,input:{cardId:string;personId:string;owner:Owner;mode:string;rules:Record<string,unknown>;steps:Step[]}){
 const rules={...input.rules,enrollment_steps:input.steps};
 const inserted=await db.from('cadences').insert({card_id:input.cardId,person_id:input.personId,owner:input.owner,mode:input.mode,status:'draft',rules}).select('id').single();
 if(inserted.error&&inserted.error.code!=='23505')throw new Error('Could not initialize sequence.');
 const existing=await db.from('cadences').select('id,status,owner,person_id,rules,updated_at').eq('card_id',input.cardId).single();
 if(existing.error||!existing.data)throw new Error('Could not read sequence setup.');
 const cadence=existing.data;
 if(cadence.owner!==input.owner||cadence.person_id!==input.personId)throw new CadenceExists('This company already has a sequence for another contact or sender. Existing steps were preserved.');
 if(cadence.status!=='draft'){
  const children=await db.from('cadence_steps').select('id',{count:'exact',head:true}).eq('cadence_id',cadence.id);
  if(children.error)throw new Error('Could not verify sequence steps.');
  if(cadence.status!=='active'||children.count!==0)throw new CadenceExists('This contact already has a sequence. Open Follow-ups to review it. Existing steps were preserved.');
  // Repair legacy empty parents only; never reset a sequence with any historical steps.
  const repair=await db.from('cadences').update({status:'draft',rules}).eq('id',cadence.id).eq('updated_at',cadence.updated_at).select('id');
  if(repair.error||!repair.data?.length)throw new Error('Sequence changed during repair. Reload and retry.');
  cadence.rules=rules;
 }
 const steps=(cadence.rules as typeof rules).enrollment_steps;
 if(!Array.isArray(steps)||!steps.length)throw new Error('Sequence setup is missing its saved steps. Review before activating.');
 const children=await db.from('cadence_steps').upsert(steps.map(step=>({...step,cadence_id:cadence.id})),{onConflict:'cadence_id,step_number',ignoreDuplicates:true});
 if(children.error)throw new Error('Sequence setup is incomplete. Retry to finish the saved steps; nothing can send yet.');
 const count=await db.from('cadence_steps').select('id',{count:'exact',head:true}).eq('cadence_id',cadence.id);
 if(count.error||count.count!==steps.length)throw new Error('Sequence steps are incomplete. Retry setup.');
 const active=await db.from('cadences').update({status:'active',activated_at:new Date().toISOString()}).eq('id',cadence.id).eq('status','draft');
 if(active.error)throw new Error('Steps saved but activation failed. Retry setup.');
 return {id:cadence.id,steps:steps.length};
}
