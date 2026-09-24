import { emailMime } from "./email-mime.ts";
import { emailStyle } from "./email-style.ts";
import { decrypt } from "./crypto.ts";import { admin } from "./supabase/admin.ts";import type { Owner } from "./types.ts";
// Trim every value: credentials pasted into a dashboard often carry a stray newline or space,
// which Google rejects as invalid_client / redirect_uri_mismatch. Never send that whitespace.
function config(){return {client_id:(process.env.GOOGLE_CLIENT_ID??"").trim(),client_secret:(process.env.GOOGLE_CLIENT_SECRET??"").trim(),redirect_uri:(process.env.GOOGLE_REDIRECT_URI??"").trim()}}
// Send + read replies (for cadence) and full Calendar (free/busy + create invites for "Propose times"); userinfo.email captures the real connected address.
export const GOOGLE_SCOPES="openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar";
/** Short-lived cookie that binds an OAuth handshake to the browser that began it (CSRF nonce). */
export const OAUTH_STATE_COOKIE="gmail_oauth_state";
export function oauthUrl(owner:Owner,nonce?:string){const {client_id,redirect_uri}=config();const state=nonce?`${owner}.${nonce}`:owner;const q=new URLSearchParams({client_id,redirect_uri,response_type:"code",scope:GOOGLE_SCOPES,access_type:"offline",prompt:"select_account consent",include_granted_scopes:"true",state});return `https://accounts.google.com/o/oauth2/v2/auth?${q}`}
export async function exchangeCode(code:string){const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({...config(),code,grant_type:"authorization_code"})});if(!response.ok)throw new Error("Google OAuth exchange failed");return response.json() as Promise<{access_token:string;refresh_token:string;scope:string}>}
// The email address of the account that just authorized, so we store the real sender rather than a guessed one.
// The connected account's email and display name (name needs the `profile` scope), so we can store the
// real sender address and pre-fill their signature name on connect.
export async function googleProfile(accessToken:string):Promise<{email:string|null;name:string|null}>{const response=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{authorization:`Bearer ${accessToken}`}});if(!response.ok)return {email:null,name:null};const data=await response.json() as {email?:string;name?:string};return {email:data.email??null,name:data.name??null}}
export async function googleEmail(accessToken:string){return (await googleProfile(accessToken)).email}
async function accessToken(owner:Owner){const {data}=await admin().from("gmail_connections").select("refresh_token_ciphertext").eq("owner",owner).single();if(!data)throw new Error(`Gmail is not connected for ${owner}`);const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({...config(),refresh_token:decrypt(data.refresh_token_ciphertext),grant_type:"refresh_token"})});if(!response.ok)throw new Error("Unable to refresh Gmail access");return (await response.json() as {access_token:string}).access_token}
// Exposed so the calendar helpers can call Google APIs with the same refreshed token.
export async function ownerAccessToken(owner:Owner){return accessToken(owner)}
// List recent messages in the sender's Sent mailbox (for tracking emails composed directly in Gmail).
export async function listSent(token:string,q="in:sent newer_than:3d",max=60){const res=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${max}`,{headers:{authorization:`Bearer ${token}`}});if(!res.ok)throw new Error(`Gmail list sent failed: ${res.status}`);return ((await res.json() as {messages?:Array<{id:string;threadId:string}>}).messages)??[]}
// Recipient, subject, thread and send time for one message — metadata only, no body fetch.
export async function messageMeta(token:string,id:string){const res=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject`,{headers:{authorization:`Bearer ${token}`}});if(!res.ok)throw new Error(`Gmail message meta failed: ${res.status}`);const data=await res.json() as {internalDate?:string;threadId?:string;payload?:{headers?:Array<{name:string;value:string}>}};const headers=data.payload?.headers??[];const get=(n:string)=>headers.find((h)=>h.name.toLowerCase()===n.toLowerCase())?.value??"";return {to:get("To"),subject:get("Subject"),threadId:data.threadId??"",dateMs:Number(data.internalDate??0)}}
// Decode a Gmail base64url body part to text.
const decodeB64Url=(data:string)=>Buffer.from(data.replace(/-/g,"+").replace(/_/g,"/"),"base64").toString("utf8");
// Walk a Gmail payload tree and return the message body as readable text: prefer text/plain,
// fall back to a stripped text/html. Handles nested multipart/alternative + multipart/mixed.
function extractBody(payload:unknown):string{
  const plain:string[]=[]; const html:string[]=[];
  const walk=(p:{mimeType?:string;body?:{data?:string};parts?:unknown[]})=>{
    if(!p) return;
    if(p.mimeType==="text/plain"&&p.body?.data) plain.push(decodeB64Url(p.body.data));
    else if(p.mimeType==="text/html"&&p.body?.data) html.push(decodeB64Url(p.body.data));
    for(const c of (p.parts??[]) as Array<typeof p>) walk(c);
  };
  walk(payload as {mimeType?:string;body?:{data?:string};parts?:unknown[]});
  if(plain.length) return plain.join("\n").trim();
  if(html.length) return html.join("\n").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<br\s*\/?>(?=)/gi,"\n").replace(/<\/(p|div|tr|table)>/gi,"\n").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/[ \t]{2,}/g," ").replace(/\n{3,}/g,"\n\n").trim();
  return "";
}
// The full body text of one sent message (used when logging a Gmail-composed send to History).
export async function messageBody(token:string,id:string){const res=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,{headers:{authorization:`Bearer ${token}`}});if(!res.ok)throw new Error(`Gmail message body failed: ${res.status}`);const data=await res.json() as {payload?:unknown};return extractBody(data.payload)}
// The subject + full body of a thread's first (outbound) message — for reading a send back in History.
export async function threadText(token:string,threadId:string){const res=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,{headers:{authorization:`Bearer ${token}`}});if(!res.ok)throw new Error(`Gmail thread failed: ${res.status}`);const data=await res.json() as {messages?:Array<{payload?:{headers?:Array<{name:string;value:string}>}}>};const msg=data.messages?.[0];if(!msg)return {subject:"",body:""};const headers=msg.payload?.headers??[];const subject=headers.find((h)=>h.name.toLowerCase()==="subject")?.value??"";return {subject,body:extractBody(msg.payload)}}
export async function sendEmail(owner:Owner,from:string,to:string,subject:string,body:string,threadId?:string,cc?:string[],html?:string,listUnsubscribe?:string){
  const mime=emailMime({from,to,subject:emailStyle(subject),body:emailStyle(body),html,cc,listUnsubscribe});
  const token=await accessToken(owner);
  const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({raw:Buffer.from(mime).toString("base64url"),threadId})});
  if(!response.ok)throw new Error(`Gmail send failed: ${response.status}`);
  return response.json() as Promise<{id:string;threadId:string}>;
}
export async function thread(owner:Owner,id:string){const token=await accessToken(owner);const response=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=full`,{headers:{authorization:`Bearer ${token}`}});if(!response.ok)throw new Error(`Gmail thread read failed: ${response.status}`);return response.json() as Promise<{messages:Array<{id:string;internalDate:string;payload:{headers:Array<{name:string;value:string}>;body?:{data?:string};parts?:Array<{mimeType:string;body:{data?:string}}>}}>}>}
