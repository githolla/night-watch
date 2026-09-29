import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function enrollment(existing=false){
 let created=existing,stepWrites=0,deletes=0;
 const db={from(table:string){const q={select(){return q},eq(){return q},insert(){if(table==='cadence_steps')stepWrites++;return q},update(){return q},delete(){deletes++;throw new Error('Must never delete existing steps')},single:async()=>{if(table==='cards')return {data:{id:'card',person_id:'person',people:{email_status:'verified'},accounts:{status:'prospect',domain:'example.com'}}};if(created)return {error:{code:'23505'}};created=true;return {data:{id:'cadence'}}},then(resolve:(v:unknown)=>unknown){return Promise.resolve(resolve({error:null}))}};return q}};
 const exports:Record<string,(req:Request,ctx:unknown)=>Promise<Response>>={};
 const mocks:Record<string,unknown>={'@/lib/auth':{requireUser:async()=>({owner:'jenna'})},'@/lib/focus-data':{assertListSender:()=>{}},'@/lib/supabase/admin':{admin:()=>db}};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../app/api/cards/[id]/cadence/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Date,Intl,Response,require:(n:string)=>n==='zod'?require('zod'):mocks[n]});
 const post=()=>exports.POST(new Request('https://test',{method:'POST',body:JSON.stringify({mode:'automatic',stopOnReply:true,weekdaysOnly:true,sendWindow:'9-5',timeZone:'America/New_York',steps:[{day:0,channel:'email',title:'Intro email',detail:'Opening draft',subject:'Subject',body:'Hello?'}]})}),{params:Promise.resolve({id:'card'})});
 return {post,stats:()=>({stepWrites,deletes})};
}
test('reenrollment returns conflict without changing an existing sequence',async()=>{const h=enrollment(true);const response=await h.post();assert.equal(response.status,409);assert.match((await response.json()).error,/preserved/);assert.deepEqual(h.stats(),{stepWrites:0,deletes:0})});
test('concurrent enrollment creates only one set of steps',async()=>{const h=enrollment();const responses=await Promise.all([h.post(),h.post()]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.deepEqual(h.stats(),{stepWrites:1,deletes:0})});
