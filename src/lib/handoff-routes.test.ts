import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function route(path:string, mocks:Record<string,unknown>) {
 const source=readFileSync(new URL(path,import.meta.url),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports:Record<string,(...args:unknown[])=>Promise<Response>>={};
 runInNewContext(output,{exports,Response,URL,Date,AbortSignal,fetch:mocks.fetch,require:(name:string)=>{
  if(name==='zod')return require('zod');
  if(name in mocks)return mocks[name];
  throw new Error('Unmocked dependency '+name);
 }});
 return exports;
}
test('restore with existing copy returns an updated card rather than an empty update',async()=>{
 let patch:Record<string,unknown>={};
 const record={id:'card',email_body:'Saved copy',email_subject:'Subject',status:'edited'};
 const db={from(){const q={select(){return q},eq(){return q},in(){return q},update(value:Record<string,unknown>){patch=value;return q},single:async()=>({data:record}),maybeSingle:async()=>Object.keys(patch).length?{data:record}:{error:new Error('Empty update')}};return q;}};
 const r=route('../app/api/cards/[id]/route.ts',{
  '@/lib/restore-selected-draft':{restoreSelectedDraft:async()=> 'edited'},'@/lib/focus-data':{},'@/lib/version-tracking':{},'@/lib/version-attribution':{},'@/lib/outreach-variants':{},'@/lib/sender':{},'@/lib/email-style':{emailStyle:(v:string)=>v},'@/lib/auth':{requireUser:async()=>({owner:'jenna'})},'@/lib/supabase/admin':{admin:()=>db},
 });
 const response=await r.PATCH(new Request('https://test/api',{method:'PATCH',body:JSON.stringify({reopen:true})}),{params:Promise.resolve({id:'card'})});
 assert.equal(response.status,200);assert.equal(patch.status,'edited');assert.equal(patch.email_body,undefined);
});
test('a self-test accepted by Gmail remains successful when the history read throws',async()=>{
 let sends=0;
 const db={from(table:string){const q={select(){return q},eq(){return q},gte(){return q},maybeSingle:async()=>({data:{email:'self@example.com'}}),single:async()=>{if(table==='message_variants')throw new Error('DB disconnected');return {data:{person_id:'person',account_id:'account',people:{full_name:'Louis'},accounts:{domain:'dortchenterprises.com'}}}},then(resolve:(v:unknown)=>unknown){return Promise.resolve(resolve({count:0,error:null}))}};return q;}};
 const r=route('../app/api/cards/[id]/test-email/route.ts',{
  '@/lib/focus-data':{batchOwner:()=> 'jenna'},'@/lib/first-touch':{firstTouchErrors:()=>[]},'@/lib/gift-tracking':{},'@/lib/authored-sender':{authoredSenderDraft:()=>({body:'Hello?'})},'@/lib/auth':{requireUser:async()=>({owner:'jenna'})},'@/lib/supabase/admin':{admin:()=>db},'@/lib/gmail':{sendEmail:async(...args:unknown[])=>{sends++;assert.equal(args[2],'self@example.com');assert.deepEqual(Array.from(args[6] as unknown[]),[]);return {id:'message',threadId:'thread'}}},'@/lib/sender':{senderProfile:async()=>({fromName:'Suuchi'}),fromHeader:()=> 'Suuchi',sanitizeLinks:(v:string)=>v},'@/lib/outreach-ending':{outreachDelivery:()=>({text:'Hello?',html:'<p>Hello?</p>'})},'@/lib/open-tracking':{},'@/lib/version-tracking':{trackEmailVersion:async()=> 'snapshot'},'@/lib/version-attribution':{SAVED_VERSION_MODEL:'saved',versionLabel:()=> 'Direct Offer'},
 });
 const response=await r.POST(new Request('https://test/api',{method:'POST',body:JSON.stringify({subject:'Test',body:'Hello?'})}),{params:Promise.resolve({id:'card'})});
 const result=await response.json();assert.equal(response.status,200);assert.equal(result.ok,true);assert.match(result.warning,/test was sent/i);assert.equal(sends,1);
});

test('connection health reports verified access and missing seats without exposing tokens',async()=>{
 const r=route('../app/api/admin/connection-health/route.ts',{
  '@/lib/auth':{requireAdmin:async()=>({owner:'josh'})},
  '@/lib/supabase/admin':{admin:()=>({from:()=>({select:async()=>({data:[{owner:'josh',email:'self@example.com',scopes:'https://www.googleapis.com/auth/gmail.send'}]})})})},
  '@/lib/gmail':{ownerAccessToken:async()=> 'private-token'},
  fetch:async()=>Response.json({emailAddress:'self@example.com'}),
 });
 const response=await r.GET();const data=await response.json();
 assert.equal(data.accounts[0].connected,true);assert.equal(data.accounts[1].connected,false);assert.equal(data.accounts[1].name,'Suuchi');assert.ok(!JSON.stringify(data).includes('private-token'));
});
test('connection health denies non-admin requests before reading connections',async()=>{
 const r=route('../app/api/admin/connection-health/route.ts',{'@/lib/auth':{requireAdmin:async()=>{throw new Error('Admins only')}},'@/lib/supabase/admin':{admin:()=>{throw new Error('Must not read')}},'@/lib/gmail':{}});
 assert.equal((await r.GET()).status,403);
});

test('restoring a blank Suuchi draft uses Suuchi identity even when Josh views it',async()=>{
 let patch:Record<string,unknown>={};let profileOwner='';
 const record={email_body:'',email_subject:'',status:'edited',accounts:{domain:'dortchenterprises.com'},people:{full_name:'Louis Dortch Jr.'}};
 const db={from(){const q={select(){return q},eq(){return q},in(){return q},update(value:Record<string,unknown>){patch=value;return q},single:async()=>({data:record}),maybeSingle:async()=>({data:{...record,...patch}})};return q;}};
 const r=route('../app/api/cards/[id]/route.ts',{
  '@/lib/restore-selected-draft':{restoreSelectedDraft:async()=> 'edited'},'@/lib/focus-data':{batchOwner:()=> 'jenna'},'@/lib/version-tracking':{},'@/lib/version-attribution':{},
  '@/lib/outreach-variants':{savedVariants:()=>[{id:'direct-offer'}],renderSavedVariant:(_v:unknown,name:string,sender:string)=>({subject:'Direct offer',body:`Hi ${name}, I am ${sender}. Can we help?`})},
  '@/lib/sender':{senderProfile:async(_db:unknown,owner:string)=>{profileOwner=owner;return {fromName:'Suuchi',greeting:'Hi {first},'}}},'@/lib/email-style':{emailStyle:(v:string)=>v},'@/lib/auth':{requireUser:async()=>({owner:'josh'})},'@/lib/supabase/admin':{admin:()=>db},
 });
 const response=await r.PATCH(new Request('https://test/api',{method:'PATCH',body:JSON.stringify({reopen:true})}),{params:Promise.resolve({id:'card'})});
 assert.equal(response.status,200);assert.equal(profileOwner,'jenna');assert.match(String(patch.email_body),/Suuchi/);assert.doesNotMatch(String(patch.email_body),/Josh/);assert.equal(patch.email_subject,'Direct offer');
});
test('a revoked Google connection cannot show green',async()=>{
 const r=route('../app/api/admin/connection-health/route.ts',{
  '@/lib/auth':{requireAdmin:async()=>({owner:'josh'})},
  '@/lib/supabase/admin':{admin:()=>({from:()=>({select:async()=>({data:[{owner:'jenna',email:'self@example.com',scopes:'https://www.googleapis.com/auth/gmail.send'}]})})})},
  '@/lib/gmail':{ownerAccessToken:async()=>{throw new Error('revoked')}},
 });
 const result=await (await r.GET()).json();assert.equal(result.accounts[1].connected,false);assert.match(result.accounts[1].detail,/verify Google access/);
});
