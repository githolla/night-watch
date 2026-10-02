import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {DeliveryError,deliveryReservationId} from './delivery-state.ts';
import * as bounce from './bounce.ts';
import {recipientAllowed} from './recipient-verification.ts';
function harness(options:{suppressed?:boolean|Error;countError?:boolean;reply?:boolean;bounce?:boolean;recipient?:'deliverable'|'risky'|'undeliverable';historyError?:boolean;transportError?:Error;noPrevious?:boolean;senderConflict?:boolean}={}) {
 let sends=0,reserved=false,releases=0,bounced=0,unsubscribe:unknown=null;
 const db={from(table:string){let count=false,write=false,del=false;const q={select(_s?:string,o?:{head?:boolean}){count=!!o?.head;return q},eq(){return q},in(){return q},is(){return q},not(){return q},gte(){return q},order(){return q},limit(){return q},update(){write=true;return q},insert(){write=true;return q},delete(){del=true;return q},maybeSingle:async()=>({data:table==='gmail_connections'?{email:'suuchi@example.com',created_at:'2020-01-01'}:options.noPrevious?null:{gmail_thread_id:'thread',sent_at:'2026-01-01'}}),then(resolve:(v:unknown)=>unknown){if(del){reserved=false;releases++;}return Promise.resolve(resolve(count?{count:options.countError?null:0,error:options.countError?{}:null}:table==='gmail_connections'?{data:[{email:'suuchi@example.com'}]}:{data:[{id:'step'}],error:write&&table==='touches'&&options.historyError?{}:null}))}};return q}};
 const mocks:Record<string,unknown>={
 './authored-sender':{authoredSenderDraft:({body}:{body:string})=>({body,senderConflict:options.senderConflict?'Draft introduces Josh but sender is Suuchi':null})},'./first-touch':{firstTouchErrors:()=>[]},'./followups':{refreshLegacyFollowup:(s:string)=>s},'./delivery-state':{DeliveryError,deliveryReservationId},'./mailbox-quota':{withMailboxQuota:async(_db:unknown,_input:unknown,fn:()=>unknown)=>fn()},
 './version-tracking':{trackEmailVersion:async()=>{if(reserved)throw new DeliveryError('delivery_reserved','Reserved');reserved=true;return 'variant'}},
 './gmail':{thread:async()=>({messages:options.reply?[{internalDate:String(Date.parse('2026-02-01')),payload:{headers:[{name:'From',value:'buyer@example.com'}]}}]:options.bounce?[{internalDate:String(Date.parse('2026-02-01')),payload:{headers:[{name:'From',value:'Mail Delivery Subsystem <mailer-daemon@googlemail.com>'},{name:'Subject',value:'Delivery Status Notification (Failure)'}]}}]:[]}),sendEmail:async(...args:unknown[])=>{sends++;unsubscribe=args[8];if(options.transportError)throw options.transportError;return {id:'message',threadId:'thread'}}},
 './bounce':bounce,'./email-suppression':{emailSuppressed:async()=>{if(options.suppressed instanceof Error)throw options.suppressed;return Boolean(options.suppressed)}},'./curated-worklist':{isCuratedDomain:()=>false},'./opt-out':{withOptOut:(d:unknown)=>d,unsubscribeUrl:()=>'https://app.test/api/unsubscribe?t=x',configuredBaseUrl:()=>'https://app.test'},
 './recipient-verification':{checkRecipient:async()=>({level:options.recipient??'deliverable',reason:`recipient ${options.recipient??'deliverable'}`,suggestion:null}),recipientAllowed,recordRecipientCheck:async()=>{},recordDelivery:async()=>{},markBounced:async()=>{bounced++;return null}},
 './send-action':{validateEmail:()=>{}},'./send-guards':{dailyCap:()=>20,sendDayStart:()=>new Date('2026-09-29')},'./sender':{sanitizeLinks:(s:string)=>s,senderProfile:async()=>({}),fromHeader:()=> 'Suuchi'},'./outreach-ending':{outreachDelivery:(s:string)=>({text:s,html:s})},
 };
 const exports:Record<string,(...args:unknown[])=>Promise<Record<string,unknown>>>={};
 runInNewContext(ts.transpileModule(readFileSync(new URL('./followup-delivery.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Error,Set,require:(name:string)=>{if(name in mocks)return mocks[name];throw new Error(name)}});
 const step={id:'step',status:'pending',sent_at:null,channel:'email',subject:'Subject',body:'Hello?',cadences:{id:'cadence',status:'active',owner:'suuchi',card_id:'card',people:{id:'person',email:'buyer@example.com',full_name:'Buyer',email_status:'verified'},cards:{accounts:{status:'prospect'}}}};
 return {send:(...viewer:[string?])=>exports.sendFollowup(db,step,viewer.length?viewer[0]:'suuchi'),step,stats:()=>({sends,reserved,releases,bounced,unsubscribe})};
}
test('a shared viewer cannot send from the other owner mailbox',async()=>{const h=harness();await assert.rejects(h.send('josh'),/Sign in as Suuchi/);assert.equal(h.stats().sends,0)});
test('follow-up count lookup failure blocks Gmail',async()=>{const h=harness({countError:true});await assert.rejects(h.send(),/daily sending limit/);assert.equal(h.stats().sends,0)});
test('live Gmail reply stops the follow-up before transport',async()=>{const h=harness({reply:true});assert.equal((await h.send()).stopped,true);assert.equal(h.stats().sends,0)});
test('history failure after accepted follow-up remains success and reservation stays',async()=>{const h=harness({historyError:true});const result=await h.send();assert.equal(result.ok,true);assert.match(String(result.warning),/Do not resend/);assert.equal(h.stats().reserved,true)});
test('unknown follow-up delivery blocks retries durably',async()=>{const h=harness({transportError:new DeliveryError('delivery_unknown','Unknown')});await assert.rejects(h.send(),/Unknown/);await assert.rejects(h.send(),/Reserved/);assert.equal(h.stats().sends,1);assert.equal(h.stats().releases,0)});
test('two concurrent follow-up sends allow only one Gmail request',async()=>{const h=harness();const outcomes=await Promise.allSettled([h.send(),h.send()]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(h.stats().sends,1)});
test('an abandoned claim is never automatically sent again',async()=>{const h=harness();Object.assign(h.step,{sent_at:'2026-01-01'});await assert.rejects(h.send(),/delivery confirmation/);assert.equal(h.stats().sends,0)});

test('explicit scheduled intro sends without previous history',async()=>{const h=harness({noPrevious:true});Object.assign(h.step,{step_number:1,title:'Intro email'});assert.equal((await h.send()).ok,true);assert.equal(h.stats().sends,1)});
test('later scheduled step still requires previous conversation',async()=>{const h=harness({noPrevious:true});Object.assign(h.step,{step_number:2,title:'Follow up'});await assert.rejects(h.send(),/original conversation/);assert.equal(h.stats().sends,0)});
test('scheduled intro cannot send when original history already exists',async()=>{const h=harness();Object.assign(h.step,{step_number:1,title:'Intro email'});await assert.rejects(h.send(),/already in History/);assert.equal(h.stats().sends,0)});

test('scheduled introduction rejects a conflicting sender identity before Gmail',async()=>{const h=harness({noPrevious:true,senderConflict:true});Object.assign(h.step,{step_number:1,title:'Intro email'});await assert.rejects(h.send(),/sender is Suuchi/);assert.equal(h.stats().sends,0)});

test('a bounce in the thread stops the sequence, records the bad address, and sends nothing',async()=>{const h=harness({bounce:true});const result=await h.send();assert.equal(result.stopped,true);assert.equal(result.bounced,true);assert.equal(h.stats().bounced,1);assert.equal(h.stats().sends,0)});
test('a bounce is not mistaken for a reply',()=>{const m=[{internalDate:String(Date.parse('2026-02-01')),payload:{headers:[{name:'From',value:'Mail Delivery Subsystem <mailer-daemon@googlemail.com>'}]}}];assert.equal(bounce.isBounce(m[0].payload.headers),true)});
test('the cron refuses an address that is not confirmed; a person may still send it',async()=>{const cron=harness({recipient:'risky'});await assert.rejects(cron.send(undefined),/confirmed address/);assert.equal(cron.stats().sends,0);const person=harness({recipient:'risky'});assert.equal((await person.send()).ok,true)});
test('a known-bad address is refused even by hand',async()=>{const h=harness({recipient:'undeliverable'});await assert.rejects(h.send(),/recipient undeliverable/);assert.equal(h.stats().sends,0)});
test('a follow-up to an address opted out on another record is refused before Gmail',async()=>{const h=harness({suppressed:true});await assert.rejects(h.send(),/opted out/);assert.equal(h.stats().sends,0)});
test('a follow-up is refused when the opt-out check cannot run',async()=>{const h=harness({suppressed:new Error('Could not check the opt-out list. Nothing was sent.')});await assert.rejects(h.send(),/Nothing was sent/);assert.equal(h.stats().sends,0)});
test('follow-ups carry a one-click List-Unsubscribe link',async()=>{const h=harness();await h.send();assert.match(String(h.stats().unsubscribe),/\/api\/unsubscribe\?t=/)});
