import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { restoreSelectedDraft } from './restore-selected-draft.ts';

function fixture(overrides = {}, count: number | null = 0, touchError: unknown = null) {
 const card = { id:'card', person_id:'person', status:'archived', dismiss_reason:null, score_breakdown:{}, accounts:{domain:'dortchenterprises.com',status:'active'}, signals:{hash:'operator-shortlist-20260923:dortchenterprises.com'}, people:{do_not_contact:false}, ...overrides };
 let writes=0;
 const db={from(table:string){
  const q={select(){return q},eq(){return q},is(){return q},update(){writes++;return q},single:async()=>({data:card,error:null}),maybeSingle:async()=>({data:{status:'edited'},error:null}),then(resolve:(v:unknown)=>unknown){return Promise.resolve(resolve(table==='touches'?{count,error:touchError}:{data:card,error:null}))}};
  return q;
 }} as unknown as SupabaseClient;
 return {db,writes:()=>writes};
}
test('Suuchi shortlist archives can be edited and sent without replacing copy',async()=>{
 const f=fixture(); assert.equal(await restoreSelectedDraft(f.db,'card'),'edited');assert.equal(f.writes(),1);
});
test('recovery never reopens restricted, dismissed, sent, manual or unrelated cards',async()=>{
 for(const change of [{status:'dismissed'},{status:'sent'},{status:'snoozed'},{dismiss_reason:'Not a fit'},{score_breakdown:{person_fit:10}},{accounts:{domain:'dortchenterprises.com',status:'do_not_contact'}},{people:{do_not_contact:true}},{signals:{hash:'other'}}]){
  const f=fixture(change);await restoreSelectedDraft(f.db,'card');assert.equal(f.writes(),0);
 }
});
test('prior outreach and unknown history fail closed',async()=>{
 for(const count of [1,null]){const f=fixture({},count);assert.equal(await restoreSelectedDraft(f.db,'card'),'archived');assert.equal(f.writes(),0)}
 const f=fixture({},0,new Error('history unavailable'));await assert.rejects(restoreSelectedDraft(f.db,'card'),/history unavailable/);assert.equal(f.writes(),0);
});
