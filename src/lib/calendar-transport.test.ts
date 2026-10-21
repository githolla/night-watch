import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function calendar(request:(url:string,init?:RequestInit)=>Promise<Response>){
 const exports:Record<string,unknown>={};runInNewContext(ts.transpileModule(readFileSync(new URL('./calendar.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Intl,Error,AbortSignal,fetch:request,require:(n:string)=>n==='node:crypto'?require(n):{ownerAccessToken:async()=> 'mock'}});
 return exports as {createInvite:(owner:string,input:Record<string,string | number>)=>Promise<unknown>;proposeTimes:(owner:string)=>Promise<unknown>};
}
const input={summary:'Intro',start:'2035-10-21T14:00:00Z',end:'2035-10-21T14:30:00Z',timeZone:'America/New_York',attendee:'test@example.com',bookingKey:'card:slot'};
test('booking recheck includes buffer and refuses an adjacent calendar conflict', async () => {
 let posted = false;
 const c = calendar(async (url, init) => {
  if (url.endsWith('/freeBusy')) {
   const body = JSON.parse(String(init?.body)) as { timeMin: string; timeMax: string };
   assert.equal(body.timeMin, '2035-10-21T13:45:00.000Z');
   assert.equal(body.timeMax, '2035-10-21T14:45:00.000Z');
   return Response.json({ calendars: { primary: { busy: [{ start: '2035-10-21T14:40:00Z', end: '2035-10-21T15:00:00Z' }] } } });
  }
  if (init?.method === 'POST') posted = true;
  return new Response('', { status: 404 });
 });
 await assert.rejects(c.createInvite('suuchi', { ...input, bufferMinutes: 15 }), /no longer available/);
 assert.equal(posted, false);
});
test('calendar per-resource error blocks proposing times',async()=>{const c=calendar(async()=>Response.json({calendars:{primary:{errors:[{reason:'notFound'}]}}}));await assert.rejects(c.proposeTimes('suuchi'),/availability/)});
test('replaying accepted invitation reuses stable event instead of POSTing again',async()=>{let event:Record<string,string>|null=null,posts=0;const c=calendar(async(url,init)=>{if(url.endsWith('/freeBusy'))return Response.json({calendars:{primary:{busy:[]}}});if(init?.method==='POST'){posts++;event=JSON.parse(String(init.body));return Response.json({htmlLink:'https://example.com/event'})}return event?Response.json({htmlLink:'https://example.com/event'}):new Response('',{status:404})});await c.createInvite('suuchi',input);await c.createInvite('suuchi',input);assert.equal(posts,1);assert.match(String((event as unknown as Record<string,string>).id),/^[0-9a-f]{64}$/)});
test('availability changed since proposal prevents invitation',async()=>{let posted=false;const c=calendar(async(url,init)=>{if(url.endsWith('/freeBusy'))return Response.json({calendars:{primary:{busy:[{start:input.start,end:input.end}]}}});if(init?.method==='POST')posted=true;return new Response('',{status:404})});await assert.rejects(c.createInvite('josh',input),/no longer available/);assert.equal(posted,false)});
test('calendar conflict returns existing event receipt',async()=>{let reads=0;const c=calendar(async(url,init)=>{if(url.endsWith('/freeBusy'))return Response.json({calendars:{primary:{busy:[]}}});if(init?.method==='POST')return new Response('',{status:409});return ++reads===1?new Response('',{status:404}):Response.json({htmlLink:'https://example.com/event'})});const result=await c.createInvite('josh',input);assert.equal((result as {htmlLink:string}).htmlLink,'https://example.com/event')});
