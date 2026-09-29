import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {deliveryReservationId} from './delivery-state.ts';
import {recoveryDetails,recoveryReady} from './delivery-recovery.ts';
const require=createRequire(import.meta.url);
function harness({legacy=false,found=false,existingTouch=false}:{legacy?:boolean;found?:boolean;existingTouch?:boolean}={}) {
 const writes:string[]=[];let touchId='';
 const row={id:deliveryReservationId('cadence:step','person'),card_id:'card',person_id:'person',owner:'jenna',status:'selected',created_at:'2020-01-01',updated_at:'2020-01-01',context:JSON.stringify({delivery:{kind:'followup',stepId:'step'}}),message_variants:[{id:'variant',body:'Body',subject:'Subject'}]};
 const step={id:'step',status:'failed',sent_at:'2020-01-01',subject:'Subject',body:'Body',cadences:{owner:'jenna',card_id:'card',person_id:'person',people:{email:'buyer@example.com'}}};
 const db={from(table:string){let operation='',goal=false;const q={select(){return q},eq(key:string){if(key==='goal')goal=true;return q},in(){return q},not(){return q},limit(){return q},gte(){return q},update(){operation='update';return q},delete(){operation='delete';return q},upsert(value:{id:string}){operation='upsert';touchId=value.id;return q},single:async()=>legacy?{error:{}}:{data:row},maybeSingle:async()=>({data:table==='cadence_steps'?step:table==='touches'&&existingTouch?{id:'old-touch'}:null}),then(resolve:(v:unknown)=>unknown){if(operation)writes.push(`${table}:${operation}${goal?':quota':''}`);return Promise.resolve(resolve({data:[{id:'step'}],error:null}))}};return q}};
 const exports:Record<string,(r:Request)=>Promise<Response>>={};
 const mocks:Record<string,unknown>={'@/lib/auth':{requireUser:async()=>({owner:'jenna'})},'@/lib/supabase/admin':{admin:()=>db},'@/lib/gmail':{ownerAccessToken:async()=> 'token'},'@/lib/delivery-recovery':{recoveryDetails,recoveryReady},'@/lib/delivery-state':{deliveryReservationId},'@/lib/mailbox-quota':{QUOTA_GOAL:'Delivery quota reservation'},'@/lib/followups':{ensureFollowupCadence:async()=>{}}};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../app/api/delivery-recovery/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Response,Date,Set,AbortSignal,fetch:async()=>Response.json({messages:found?[{id:'gmail',threadId:'thread'}]:[]}),require:(name:string)=>name==='zod'?require('zod'):mocks[name]});
 return {post:async(action:string)=>exports.POST(new Request('https://test',{method:'POST',body:JSON.stringify({id:legacy?'11111111-1111-4111-a111-111111111111':row.id,action,confirmedNotSent:true,confirmedSent:true})})),writes,touchId:()=>touchId};
}
test('releasing protected follow-up keeps message reservation until step and quota cleanup finish',async()=>{const h=harness();const response=await h.post('release');assert.equal(response.status,200);assert.deepEqual(h.writes,['cadence_steps:update','message_experiments:delete:quota','message_experiments:delete']);});
test('repair reuses an already logged touch rather than doubling history',async()=>{const h=harness({found:true,existingTouch:true});assert.equal((await h.post('check')).status,200);assert.equal(h.touchId(),'old-touch');});
test('legacy potential match needs explicit confirmation and does not write during check',async()=>{const h=harness({legacy:true,found:true});const result=await (await h.post('check')).json();assert.equal(result.legacyFound,true);assert.deepEqual(h.writes,[]);});
test('legacy no-match release clears held step only after manual confirmation',async()=>{const h=harness({legacy:true});assert.equal((await h.post('release')).status,200);assert.deepEqual(h.writes,['cadence_steps:update']);});
