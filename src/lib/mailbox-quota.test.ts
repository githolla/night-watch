import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { DeliveryError, deliveryReservationId } from './delivery-state.ts';
function harness(){
 const rows=new Map<string,unknown>();let unavailable=false;
 const db={from(){return {insert:async(row:{id:string})=>{if(unavailable)return {error:{code:'offline'}};if(rows.has(row.id))return {error:{code:'23505'}};rows.set(row.id,row);return {error:null}},delete(){let id='';const q={eq(key:string,value:string){if(key==='id')id=value;return q},then(resolve:(x:unknown)=>unknown){rows.delete(id);return Promise.resolve(resolve({error:null}))}};return q}}}};
 const output=ts.transpileModule(readFileSync(new URL('./mailbox-quota.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports:{withMailboxQuota?:(db:unknown,input:unknown,send:()=>Promise<unknown>)=>Promise<unknown>}={};
 runInNewContext(output,{exports,Error,require:()=>({DeliveryError,deliveryReservationId})});
 const input={owner:'jenna',cardId:'card',personId:'person',count:0,cap:1,dayStart:new Date('2026-09-29T04:00:00Z'),reservationId:'reservation'};
 return {run:(send:()=>Promise<unknown>,override={})=>exports.withMailboxQuota!(db,{...input,...override},send),rows,offline:()=>{unavailable=true}};
}
test('simultaneous different contacts cannot both take the final mailbox slot',async()=>{
 const h=harness();let sends=0;const send=async()=>{sends++;return 'accepted'};
 const results=await Promise.allSettled([h.run(send),h.run(send,{personId:'colleague'})]);
 assert.equal(sends,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
});
test('unknown delivery retains quota but a definite pre-send failure releases it',async()=>{
 const h=harness();await assert.rejects(h.run(async()=>{throw new DeliveryError('delivery_unknown','unknown')}));assert.equal(h.rows.size,1);
 await assert.rejects(h.run(async()=>{}),/cap/);
 const other=harness();await assert.rejects(other.run(async()=>{throw new Error('token rejected')}));assert.equal(other.rows.size,0);await other.run(async()=>{});assert.equal(other.rows.size,1);
});
test('unavailable quota storage stops delivery',async()=>{const h=harness();h.offline();let sent=false;await assert.rejects(h.run(async()=>{sent=true}),/reserve/);assert.equal(sent,false)});
