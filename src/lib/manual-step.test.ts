import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {memoryDb} from './testing/memory-db.ts';
import {deliveryReservationId} from './delivery-state.ts';
const require=createRequire(import.meta.url);
function harness(claimed=false){
 const h=memoryDb({cadence_steps:[{id:'s',status:'pending',channel:'email',body:'Hi?',subject:'Hello',sent_at:claimed?'2026-01-01':null,cadences:{card_id:'c',owner:'jenna',person_id:'p'}}],cards:[{id:'c',account_id:'a',person_id:'p',status:'sent'}],people:[{id:'p',account_id:'a',full_name:'Buyer',first_name:'Buyer'}],accounts:[{id:'a',name:'Example',status:'prospect'}]});
 const mocks:Record<string,unknown>={'@/lib/supabase/admin':{admin:()=>h.db},'@/lib/auth':{requireUser:async()=>({owner:'jenna'})},'@/lib/delivery-state':{deliveryReservationId},'@/lib/version-tracking':{trackEmailVersion:async()=> 'v',trackLinkedInVersion:async()=> 'v'},'@/lib/followups':{ensureFollowupCadence:async()=>({})}};
 function load(path:string){const exports:Record<string,unknown>={};runInNewContext(ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Date,Response,require:(n:string)=>n==='zod'?require('zod'):mocks[n]});return exports;}
 mocks['@/lib/manual-outreach']=load('./manual-outreach.ts');
 const route=load('../app/api/cadence-steps/[id]/route.ts') as {PATCH:(r:Request,c:unknown)=>Promise<Response>};
 return {...h,post:(action='sent')=>route.PATCH(new Request('https://test',{method:'PATCH',body:JSON.stringify({action})}),{params:Promise.resolve({id:'s'})})};
}
test('concurrent manual confirmations log one touch',async()=>{const h=harness();await Promise.all([h.post(),h.post()]);assert.equal(h.tables.touches.length,1);assert.equal(h.tables.cadence_steps[0].status,'sent')});
test('held transport cannot be marked manually sent or skipped',async()=>{const h=harness(true);assert.equal((await h.post()).status,400);assert.equal((await h.post('skipped')).status,400);assert.equal(h.tables.touches,undefined)});
test('manual record retry uses deterministic touch after previous close failed',async()=>{const h=harness();h.tables.cadence_steps[0].sent_at='2026-01-01';h.tables.cadence_steps[0].error='Manual activity pending';h.tables.touches=[{id:deliveryReservationId('manual-step:s','p'),card_id:'c',person_id:'p'}];assert.equal((await h.post()).status,200);assert.equal(h.tables.touches.length,1);assert.equal(h.tables.cadence_steps[0].status,'sent')});
test('skip wins before a manual confirmation and no history is invented',async()=>{const h=harness();assert.equal((await h.post('skipped')).status,200);assert.equal((await h.post()).status,400);assert.equal(h.tables.touches,undefined)});
