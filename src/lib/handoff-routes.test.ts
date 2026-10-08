import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import { DeliveryError, deliveryErrorResponse, deliveryReservationId } from './delivery-state.ts';
const require = createRequire(import.meta.url);
function route(path:string, mocks:Record<string,unknown>) {
 const source=readFileSync(new URL(path,import.meta.url),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports:Record<string,(...args:unknown[])=>Promise<Response>>={};
 runInNewContext(output,{exports,Error,Response,URL,Date,AbortSignal,process:{env:{}},fetch:mocks.fetch,require:(name:string)=>{
  if(name==='zod')return require('zod');
  if(name==='@/lib/delivery-state' || name==='./delivery-state') return {DeliveryError, deliveryErrorResponse, deliveryReservationId};
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
  '@/lib/restore-selected-draft':{restoreSelectedDraft:async()=> 'edited'},'@/lib/focus-data':{},'@/lib/version-tracking':{},'@/lib/version-attribution':{},'@/lib/outreach-variants':{},'@/lib/sender':{},'@/lib/email-style':{emailStyle:(v:string)=>v},'@/lib/auth':{requireUser:async()=>({owner:'suuchi'})},'@/lib/supabase/admin':{admin:()=>db},
 });
 const response=await r.PATCH(new Request('https://test/api',{method:'PATCH',body:JSON.stringify({reopen:true})}),{params:Promise.resolve({id:'card'})});
 assert.equal(response.status,200);assert.equal(patch.status,'edited');assert.equal(patch.email_body,undefined);
});
test('a self-test accepted by Gmail remains successful when the history read throws',async()=>{
 let sends=0;
 const db={from(table:string){const q={select(){return q},eq(){return q},gte(){return q},maybeSingle:async()=>({data:{email:'self@example.com'}}),single:async()=>{if(table==='message_variants')throw new Error('DB disconnected');return {data:{person_id:'person',account_id:'account',people:{full_name:'Louis'},accounts:{domain:'dortchenterprises.com'}}}},then(resolve:(v:unknown)=>unknown){return Promise.resolve(resolve({count:0,error:null}))}};return q;}};
 const r=route('../app/api/cards/[id]/test-email/route.ts',{
  '@/lib/focus-data':{batchOwner:()=> 'suuchi'},'@/lib/first-touch':{firstTouchErrors:()=>[]},'@/lib/gift-tracking':{},'@/lib/authored-sender':{authoredSenderDraft:()=>({body:'Hello?'})},'@/lib/auth':{requireUser:async()=>({owner:'suuchi'})},'@/lib/supabase/admin':{admin:()=>db},'@/lib/gmail':{sendEmail:async(...args:unknown[])=>{sends++;assert.equal(args[2],'self@example.com');assert.deepEqual(Array.from(args[6] as unknown[]),[]);return {id:'message',threadId:'thread'}}},'@/lib/sender':{senderProfile:async()=>({fromName:'Suuchi'}),fromHeader:()=> 'Suuchi',sanitizeLinks:(v:string)=>v},'@/lib/outreach-ending':{outreachDelivery:()=>({text:'Hello?',html:'<p>Hello?</p>'})},'@/lib/open-tracking':{},'@/lib/version-tracking':{trackEmailVersion:async()=> 'snapshot'},'@/lib/version-attribution':{SAVED_VERSION_MODEL:'saved',versionLabel:()=> 'Direct Offer'},
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
  '@/lib/restore-selected-draft':{restoreSelectedDraft:async()=> 'edited'},'@/lib/focus-data':{batchOwner:()=> 'suuchi'},'@/lib/version-tracking':{},'@/lib/version-attribution':{},
  '@/lib/outreach-variants':{savedVariants:()=>[{id:'direct-offer'}],renderSavedVariant:(_v:unknown,name:string,sender:string)=>({subject:'Direct offer',body:`Hi ${name}, I am ${sender}. Can we help?`})},
  '@/lib/sender':{senderProfile:async(_db:unknown,owner:string)=>{profileOwner=owner;return {fromName:'Suuchi',greeting:'Hi {first},'}}},'@/lib/email-style':{emailStyle:(v:string)=>v},'@/lib/auth':{requireUser:async()=>({owner:'josh'})},'@/lib/supabase/admin':{admin:()=>db},
 });
 const response=await r.PATCH(new Request('https://test/api',{method:'PATCH',body:JSON.stringify({reopen:true})}),{params:Promise.resolve({id:'card'})});
 assert.equal(response.status,200);assert.equal(profileOwner,'suuchi');assert.match(String(patch.email_body),/Suuchi/);assert.doesNotMatch(String(patch.email_body),/Josh/);assert.equal(patch.email_subject,'Direct offer');
});
test('a revoked Google connection cannot show green',async()=>{
 const r=route('../app/api/admin/connection-health/route.ts',{
  '@/lib/auth':{requireAdmin:async()=>({owner:'josh'})},
  '@/lib/supabase/admin':{admin:()=>({from:()=>({select:async()=>({data:[{owner:'suuchi',email:'self@example.com',scopes:'https://www.googleapis.com/auth/gmail.send'}]})})})},
  '@/lib/gmail':{ownerAccessToken:async()=>{throw new Error('revoked')}},
 });
 const result=await (await r.GET()).json();assert.equal(result.accounts[1].connected,false);assert.match(result.accounts[1].detail,/verify Google access/);
});


test('database uniqueness permits only one concurrent delivery snapshot', async () => {
 const ids=new Set<string>(); let variants=0;
 const db={from(table:string){return {insert(value:Record<string,unknown>){return {select(){return {async single(){
   if(table==='message_experiments') {
     if(ids.has(String(value.id))) return {error:{code:'23505'}};
     ids.add(String(value.id)); return {data:{id:value.id}};
   }
   variants++; return {data:{id:'variant'}};
 }}}}}}}};
 const r=route('./version-tracking.ts',{'./sender':{},'./version-attribution':{SAVED_VERSION_MODEL:'saved-email-v1'}});
 const input={cardId:'card',personId:'person',owner:'suuchi',subject:'Subject',body:'Body',reservationId:deliveryReservationId('card','person'),meta:{channel:'email',source:'gmail'}};
 const outcomes=await Promise.allSettled([r.snapshotVersion(db,input),r.snapshotVersion(db,input)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(variants,1);
 const failure=outcomes.find(x=>x.status==='rejected') as PromiseRejectedResult;
 assert.equal(failure.reason.code,'delivery_reserved');
});

function sendHarness(options: { count?: number | null; countError?: boolean; transportError?: Error; historyFailure?: boolean } = {}) {
 let sends=0; let reserved=false; let releases=0;
 const db={from(){
  let countQuery=false; let daily=false; let deleting=false; let updating=false;
  const q={select(_fields?:unknown,opts?:{head?:boolean}){countQuery=!!opts?.head;return q},eq(){return q},not(){return q},gte(){daily=true;return q},
   delete(){deleting=true;return q},update(){updating=true;return q},insert(){updating=true;return q},
   single:async()=>({data:{status:'edited',person_id:'person',account_id:'account',people:{id:'person',full_name:'Louis',email:'recipient@example.com',email_status:'verified'},accounts:{domain:'example.com',status:'active'}}}),
   maybeSingle:async()=>({data:{email:'suuchi@example.com'}}),
   then(resolve:(v:unknown)=>unknown){
    if(deleting){releases++;reserved=false;}
    if(updating && options.historyFailure) return Promise.resolve(resolve({error:{message:'offline'}}));
    return Promise.resolve(resolve(countQuery ? {count:daily ? (options.count === undefined ? 0 : options.count) : 0,error:daily&&options.countError?{message:'offline'}:null} : {error:null}));
   }
  };return q;
 }};
 const r=route('./card-send.ts',{
  '@/lib/nightly-lists':{loadNightlyLists:async()=>{}},
  '@/lib/mailbox-quota':{withMailboxQuota:async(_db:unknown,_input:unknown,action:()=>Promise<unknown>)=>action()},'@/lib/restore-selected-draft':{},'@/lib/focus-data':{assertListSender:()=>{},assertCardSender:()=>{},allFocus:()=>[]},
  '@/lib/email-suppression':{emailSuppressed:async()=>false},'@/lib/morning-send-rules':{automaticContentProblem:()=>null},
  '@/lib/bulk-sendable':{bulkSendable:()=>false},
  '@/lib/recipient-verification':{checkRecipient:async()=>({level:'risky',reason:'Not confirmed.',suggestion:null}),recipientAllowed:()=>true,recordRecipientCheck:async()=>{},recordDelivery:async()=>{}},
  '@/lib/opt-out':{withOptOut:(delivery:unknown)=>delivery,unsubscribeUrl:()=> 'https://test/api/unsubscribe?t=token'},'@/lib/first-touch':{firstTouchErrors:()=>[]},
  '@/lib/authored-sender':{authoredSenderDraft:()=>({body:'Can we help?'})},
  '@/lib/version-tracking':{trackEmailVersion:async()=>{if(reserved)throw new DeliveryError('delivery_reserved','Already sending');reserved=true;return 'variant'}},
  '@/lib/auth':{requireUser:async()=>({owner:'suuchi'})},'@/lib/crypto':{encrypt:()=> 'token'},
  '@/lib/gmail':{sendEmail:async()=>{sends++;if(options.transportError)throw options.transportError;return {id:'message',threadId:'thread'}}},
  '@/lib/followups':{ensureFollowupCadence:async()=>{}},'@/lib/send-action':{sendInput:{parse:(x:unknown)=>x},validateEmail:()=>{}},
  '@/lib/send-guards':{dailyCap:()=>5,sendDayStart:()=>new Date()},
  '@/lib/sender':{sanitizeLinks:(v:string)=>v,senderProfile:async()=>({fromName:'Suuchi',cc:[]}),fromHeader:()=> 'Suuchi'},
  '@/lib/urls':{outboundBaseUrl:()=> 'https://test'},'@/lib/supabase/admin':{admin:()=>db},'@/lib/curated-worklist':{isCuratedDomain:()=>true},
  '@/lib/outreach-ending':{outreachBody:(v:string)=>v,outreachDelivery:()=>({text:'Can we help?',html:'<p>Can we help?</p>'})},
 });
 // The route is a thin wrapper now: call the shared send and map errors exactly as it does.
 return {run:async()=>{try{return Response.json(await (r.sendCardEmail as unknown as (db:unknown,input:unknown)=>Promise<unknown>)(db,{cardId:'card',owner:'suuchi',subject:'Subject',body:'Can we help?',baseUrl:'https://test'}))}catch(error){return deliveryErrorResponse(error)}},state:()=>({sends,reserved,releases})};
}
for(const options of [{count:null},{countError:true}]) test('daily count failure blocks Gmail: '+JSON.stringify(options),async()=>{
 const h=sendHarness(options);const result=await h.run();assert.equal(result.status,400);assert.match((await result.json()).error,/daily sending limit/);assert.equal(h.state().sends,0);
});
test('uncertain delivery holds its reservation and blocks another send',async()=>{
 const h=sendHarness({transportError:new DeliveryError('delivery_unknown','Check Sent')});
 assert.equal((await (await h.run()).json()).code,'delivery_unknown');
 assert.equal((await (await h.run()).json()).code,'delivery_reserved');
 assert.deepEqual(h.state(),{sends:1,reserved:true,releases:0});
});
test('Gmail rejection releases the reservation for a safe retry',async()=>{
 const h=sendHarness({transportError:new DeliveryError('delivery_rejected','Rejected')});
 assert.equal((await (await h.run()).json()).code,'delivery_rejected');
 assert.deepEqual(h.state(),{sends:1,reserved:false,releases:1});
});
test('accepted delivery stays reserved even if all history writes fail',async()=>{
 const h=sendHarness({historyFailure:true});
 const result=await (await h.run()).json();assert.equal(result.ok,true);assert.match(result.warning,/do not resend/);
 assert.equal((await (await h.run()).json()).code,'delivery_reserved');assert.equal(h.state().sends,1);
});

test('a stale draft revision returns conflict and cannot overwrite another session', async () => {
 const record={id:'card',status:'edited',email_subject:'Other person latest subject',updated_at:'2026-09-29T15:00:00.000Z'};
 const filters=new Map<string,unknown>(); let payload:Record<string,unknown>={}; let wrote=false;
 const db={from(){ const q={
  update(value:Record<string,unknown>){payload=value;return q;},
  eq(key:string,value:unknown){filters.set(key,value);return q;}, in(){return q;},select(){return q;},
  async maybeSingle(){
   if(filters.get('updated_at') !== record.updated_at) return {data:null,error:null};
   wrote=true;return {data:{...record,...payload},error:null};
  }
 };return q;}};
 const r=route('../app/api/cards/[id]/route.ts',{
  '@/lib/restore-selected-draft':{restoreSelectedDraft:async()=> 'edited'},'@/lib/focus-data':{},'@/lib/version-tracking':{},'@/lib/version-attribution':{},'@/lib/outreach-variants':{},'@/lib/sender':{},'@/lib/email-style':{emailStyle:(v:string)=>v},'@/lib/auth':{requireUser:async()=>({owner:'suuchi'})},'@/lib/supabase/admin':{admin:()=>db},
 });
 const response=await r.PATCH(new Request('https://test/api',{method:'PATCH',body:JSON.stringify({email_subject:'My stale edit',expected_updated_at:'2026-09-29T14:00:00.000Z'})}),{params:Promise.resolve({id:'card'})});
 assert.equal(response.status,409);assert.equal(wrote,false);assert.match((await response.json()).error,/another session/);
 assert.equal(filters.get('updated_at'),'2026-09-29T14:00:00.000Z');assert.ok(!('expected_updated_at' in payload));
});

test('version-checked edit restores an automatic shortlist archive without losing the edit',async()=>{
 const {memoryDb}=await import('./testing/memory-db.ts');
 const {restoreSelectedDraft}=await import('./restore-selected-draft.ts');
 const h=memoryDb({cards:[{id:'card',person_id:'person',status:'archived',updated_at:'v1',dismiss_reason:null,score_breakdown:{},accounts:{domain:'dortchenterprises.com',status:'active'},signals:{hash:'operator-shortlist-20260923:dortchenterprises.com'},people:{do_not_contact:false},email_body:'Old draft'}]});
 const r=route('../app/api/cards/[id]/route.ts',{'@/lib/restore-selected-draft':{restoreSelectedDraft},'@/lib/focus-data':{},'@/lib/version-tracking':{},'@/lib/version-attribution':{},'@/lib/outreach-variants':{},'@/lib/sender':{},'@/lib/email-style':{emailStyle:(v:string)=>v},'@/lib/auth':{requireUser:async()=>({owner:'suuchi'})},'@/lib/supabase/admin':{admin:()=>h.db}});
 const response=await r.PATCH(new Request('https://test',{method:'PATCH',body:JSON.stringify({email_body:'Suuchi edited this',expected_updated_at:'v1'})}),{params:Promise.resolve({id:'card'})});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.email_body,'Suuchi edited this');assert.equal(data.status,'edited');assert.equal(data.restored,true);
});
test('stale archived edit never overwrites another session',async()=>{
 const {memoryDb}=await import('./testing/memory-db.ts');const {restoreSelectedDraft}=await import('./restore-selected-draft.ts');
 const h=memoryDb({cards:[{id:'card',person_id:'person',status:'archived',updated_at:'v2',dismiss_reason:null,score_breakdown:{},accounts:{domain:'dortchenterprises.com',status:'active'},signals:{hash:'operator-shortlist-20260923:dortchenterprises.com'},people:{do_not_contact:false},email_body:'Other session text'}]});
 const r=route('../app/api/cards/[id]/route.ts',{'@/lib/restore-selected-draft':{restoreSelectedDraft},'@/lib/focus-data':{},'@/lib/version-tracking':{},'@/lib/version-attribution':{},'@/lib/outreach-variants':{},'@/lib/sender':{},'@/lib/email-style':{emailStyle:(v:string)=>v},'@/lib/auth':{requireUser:async()=>({owner:'suuchi'})},'@/lib/supabase/admin':{admin:()=>h.db}});
 const response=await r.PATCH(new Request('https://test',{method:'PATCH',body:JSON.stringify({email_body:'Stale edit',expected_updated_at:'v1'})}),{params:Promise.resolve({id:'card'})});
 assert.equal(response.status,409);assert.equal(h.tables.cards[0].email_body,'Other session text');assert.equal(h.tables.cards[0].status,'archived');
});

test('admin acting mode enforces role and origin, selects Suuchi and preserves primary session', async () => {
 let actor={id:'admin',role:'admin'}; let reads=0; const cookies:unknown[][]=[];
 const r=route('../app/api/admin/act-as/route.ts',{
  '@/lib/auth':{requireActualUser:async()=>actor},
  '@/lib/supabase/admin':{admin:()=>({from:()=>({select:()=>({eq:async()=>{reads++;return {data:[{id:'suuchi',name:'Suuchi Ramesh',owner:'suuchi'}]}}})})})},
  '@/lib/acting-session':{ACTING_COOKIE:'nw_acting',issueActingSession:(a:string,b:string)=>`${a}:${b}`},
  'next/server':{NextResponse:{json:(data:unknown)=>Object.assign(Response.json(data),{cookies:{set:(...args:unknown[])=>cookies.push(args)}})}},
 });
 const req=(origin='https://test',stop=false)=>new Request('https://test/api/admin/act-as',{method:'POST',headers:{origin},body:JSON.stringify({stop})});
 assert.equal((await r.POST(req('https://evil'))).status,403);assert.equal(reads,0);
 actor={id:'member',role:'member'};assert.equal((await r.POST(req())).status,403);assert.equal(reads,0);
 actor={id:'admin',role:'admin'};assert.equal((await r.POST(req())).status,200);
 assert.equal(cookies[0][0],'nw_acting');assert.equal(cookies[0][1],'admin:suuchi');
 actor={id:'member',role:'member'};assert.equal((await r.POST(req('https://test',true))).status,200);assert.equal(cookies[1][1],'');
});

test('effective user uses Suuchi owner while retaining the real administrator', async () => {
 const actual={id:'admin',role:'admin',owner:'josh',name:'Josh',email:'j@example.com'};
 const target={id:'suuchi',role:'member',owner:'suuchi',name:'Suuchi',email:'s@example.com'};
 let available=true;let role='admin';
 const r=route('./auth.ts',{
  'node:crypto':{timingSafeEqual:()=>false},'react':{cache:(fn:unknown)=>fn},'next/headers':{cookies:async()=>({get:(key:string)=>({value:key==='session'?'real':'acting'})})},
  './shared-auth.ts':{SESSION_COOKIE:'session',validSharedSession:()=>false},'./session.ts':{readSession:()=>({uid:'admin'})},'./session-revocation.ts':{sessionRevoked:async()=>false},
  './users.ts':{loadUser:async(id:string)=>id==='admin'?{...actual,role}:available?target:null},
  './acting-session.ts':{ACTING_COOKIE:'acting',actingTarget:(_token:string,user:{role:string})=>{if(user.role!=='admin')throw new Error('Denied');return 'suuchi'}},
 });
 const effective=await r.requireUser() as unknown as {owner:string;actor:{id:string}};
 assert.equal(effective.owner,'suuchi');assert.equal(effective.actor.id,'admin');
 assert.equal((await r.requireAdmin() as unknown as {id:string}).id,'admin');
 available=false;await assert.rejects(r.requireUser(),/unavailable/);
 available=true;role='member';await assert.rejects(r.requireUser(),/Denied/);
});

test('sequence setup uses the existing expression-indexed person without an invalid upsert', async () => {
 for (const exists of [false,true]) {
 let inserts=0;let updates=0;
 const db={from(table:string){const q={
  select(){return q},eq(){return q},ilike(){return q},
  upsert(_value:unknown,options:{onConflict:string}){assert.notEqual(table,'people');assert.notEqual(options.onConflict,'account_id,full_name');return q},
  insert(){inserts++;return q},update(){updates++;return q},
  maybeSingle:async()=>({data:table==='gmail_connections'?{email:'suuchi@example.com'}:exists?{id:'person'}:null}),
  single:async()=>({data:{id:table==='people'?'person':table}}),
  then(resolve:(v:unknown)=>unknown){return Promise.resolve(resolve({error:null}))},
 };return q;}};
 const r=route('../app/api/admin/test-sequence/route.ts',{
  '@/lib/auth':{requireUser:async()=>({role:'member',owner:'suuchi',actor:{id:'admin'}})},
  '@/lib/supabase/admin':{admin:()=>db},
 });
 const response=await r.POST(new Request('https://test/api',{method:'POST',body:'{}'}));
 assert.equal(response.status,200);assert.equal((await response.json()).to,'suuchi@example.com');
 assert.equal(inserts,exists?0:1);assert.equal(updates,1);
 }
});
test('the settings test send comes from the seat mailbox and reaches the admin acting as that seat',async()=>{
 const sent:Array<{from:string;to:string;body:string}>=[];
 const db={from(){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{email:'Suuchi@nine-67.com'}})};return q}};
 const mocks=(actor?:{email:string})=>({
  '@/lib/auth':{requireUser:async()=>({id:'u2',name:'Suuchi Rao',owner:'suuchi',role:'member',...(actor?{actor}:{})})},
  '@/lib/supabase/admin':{admin:()=>db},
  '@/lib/gmail':{sendEmail:async(_owner:string,from:string,to:string,_subject:string,body:string)=>{sent.push({from,to,body});return {threadId:'t1'}}},
  '@/lib/sender':{senderProfile:async()=>({fromName:'Suuchi Rao',signature:'',postalAddress:'123 Main St, Pittsburgh, PA 15222'}),fromHeader:(_p:unknown,email:string)=>`Suuchi Rao <${email}>`},
  '@/lib/outreach-ending':{outreachDelivery:(body:string,profile:{postalAddress:string})=>({text:`${body}\n\n${profile.postalAddress}`,html:''})},
 });
 const send=async(actor:{email:string}|undefined,body:unknown)=>{const response=await route('../app/api/gmail/test/route.ts',mocks(actor)).POST(new Request('https://test/api',{method:'POST',body:JSON.stringify(body)}));return {status:response.status,json:await response.json()}};
 const self=await send(undefined,{});
 assert.equal(self.json.to,'suuchi@nine-67.com');assert.equal(self.json.toSelf,true);
 const acting=await send({email:'Josh@nine-67.com'},{});
 assert.equal(acting.json.to,'josh@nine-67.com');assert.equal(acting.json.toSelf,false);
 const typed=await send(undefined,{to:'Friend@Example.com'});
 assert.equal(typed.json.to,'friend@example.com');
 assert.deepEqual(sent.map(item=>item.from),Array(3).fill('Suuchi Rao <suuchi@nine-67.com>'),'From is always the seat mailbox, never the recipient');
 assert.equal((await send(undefined,{to:'not-an-email'})).status,400);
 assert.equal(sent.length,3);
 assert.ok(sent.every(item=>item.body.includes('123 Main St, Pittsburgh, PA 15222')),'the test shows the postal address footer a real send carries');
});
test('without an Anthropic key the nightly list cron skips quietly: no build, no failure alert',async()=>{
 let built=0,alerts=0;
 const r=route('../app/api/cron/nightly-list/route.ts',{
  '@/lib/auth':{cronAuthorized:()=>true},
  '@/lib/morning-messages':{buildFailureText:()=> 'failed'},
  '@/lib/nightly-list-builder':{runNightlyListBuild:async()=>{built++;return {}},claimBuildAlert:async()=>true},
  '@/lib/slack':{postSlackMessage:async()=>{alerts++;return true}},
  '@/lib/supabase/admin':{admin:()=>({})},
 });
 const response=await r.GET(new Request('https://test/api/cron/nightly-list'));
 assert.equal(response.status,200);assert.match((await response.json()).skipped,/ANTHROPIC_API_KEY/);
 assert.equal(built,0);assert.equal(alerts,0);
});
