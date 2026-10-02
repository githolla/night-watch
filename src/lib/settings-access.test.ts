import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path:string,mocks:Record<string,unknown>){
 const source=readFileSync(new URL(path,import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports:Record<string,(request?:Request)=>Promise<Response>>={};
 runInNewContext(code,{exports,Response,URL,Headers,AbortSignal,Date,process:{env:{GOOGLE_CLIENT_ID:'set',GOOGLE_CLIENT_SECRET:'set',GOOGLE_REDIRECT_URI:'https://test/callback'}},fetch:mocks.fetch,require:(key:string)=> key in mocks?mocks[key]:require(key)});
 return exports;
}
test('a member cannot reconnect the other seat or silently change their own',async()=>{
 let oauthCalls=0;
 const route=load('../app/api/gmail/connect/route.ts',{'@/lib/auth':{requireUser:async()=>({owner:'suuchi',role:'member'})},'@/lib/gmail':{oauthUrl:()=>{oauthCalls++;return 'https://google.test'},OAUTH_STATE_COOKIE:'state'}});
 const response=await route.GET(new Request('https://test/api/gmail/connect?owner=josh'));
 assert.equal(response.status,403);assert.equal(oauthCalls,0);assert.equal(response.headers.get('set-cookie'),null);
});
test('member connection health queries and checks only their own mailbox',async()=>{
 let queried='';const checked:string[]=[];
 const route=load('../app/api/gmail/health/route.ts',{
  '@/lib/auth':{requireUser:async()=>({owner:'suuchi',role:'member'})},
  '@/lib/supabase/admin':{admin:()=>({from:()=>({select:()=>({eq:async(_key:string,owner:string)=>{queried=owner;return {data:[{owner:'suuchi',email:'suuchi@example.com',scopes:'https://www.googleapis.com/auth/gmail.send'}]}}})})})},
  '@/lib/gmail':{ownerAccessToken:async(owner:string)=>{checked.push(owner);return 'secret'}},fetch:async()=>Response.json({emailAddress:'suuchi@example.com'})
 });
 const response=await route.GET();const data=await response.json();
 assert.equal(queried,'suuchi');assert.deepEqual(checked,['suuchi']);assert.equal(data.accounts.length,1);assert.equal(data.accounts[0].connected,true);assert.ok(!JSON.stringify(data).includes('secret'));
});
test('disconnect reports database failure instead of false success',async()=>{
 const route=load('../app/api/gmail/disconnect/route.ts',{'@/lib/auth':{requireUser:async()=>({owner:'suuchi',role:'member'})},'@/lib/supabase/admin':{admin:()=>({from:()=>({delete:()=>({eq:async()=>({error:{message:'offline'}})})})})}});
 const response=await route.POST(new Request('https://test/api',{method:'POST',body:JSON.stringify({owner:'suuchi'})}));assert.equal(response.status,400);assert.match((await response.json()).error,/Could not disconnect/);
});
