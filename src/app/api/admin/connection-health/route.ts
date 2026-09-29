import { requireAdmin } from '@/lib/auth';
import { admin } from '@/lib/supabase/admin';
import { ownerAccessToken } from '@/lib/gmail';
export const maxDuration = 30;
export async function GET() {
 try { await requireAdmin(); } catch { return Response.json({error:'Admin access required'},{status:403}); }
 const db=admin();
 const {data,error}=await db.from('gmail_connections').select('owner,email,scopes');
 if(error)return Response.json({error:'Could not read connections. Please retry.'},{status:503});
 const accounts=await Promise.all((['josh','jenna'] as const).map(async owner=>{
  const name=owner==='josh'?'Josh':'Suuchi';
  const row=data?.find(r=>r.owner===owner);
  const base={owner,name,email:row?.email??null};
  if(!row)return {...base,connected:false,detail:'No Google account connected.'};
  try {
   const token=await ownerAccessToken(owner);
   const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(8000)});
   if(!response.ok)return {...base,connected:false,detail:'Google access failed. Reconnect this account.'};
   const profile=await response.json() as {emailAddress?:string};
   if(!profile.emailAddress || profile.emailAddress.toLowerCase()!==row.email?.toLowerCase())return {...base,connected:false,detail:'Connected mailbox does not match the saved account. Reconnect.'};
   if(!String(row.scopes??'').split(/\s+/).some(s=>['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/'].includes(s)))return {...base,connected:false,detail:'Sending permission is missing. Reconnect and allow Gmail access.'};
   return {...base,connected:true,detail:'Google access checked; sending permission is saved.'};
  } catch { return {...base,connected:false,detail:'Could not verify Google access. Reconnect or check again.'}; }
 }));
 return Response.json({accounts,checkedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
}
