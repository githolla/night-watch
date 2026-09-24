import {requireUser} from '@/lib/auth';
import {admin} from '@/lib/supabase/admin';
import {batchOwner} from '@/lib/focus-data';
import {replaceOpening} from '@/lib/bulk-copy';
import {firstTouchErrors} from '@/lib/first-touch';
import {z} from 'zod';
const input=z.object({ids:z.array(z.string().uuid()).min(1).max(100),owner:z.enum(['josh','jenna']),field:z.enum(['subject','opening']),value:z.string().trim().min(1).max(400)});
export async function POST(request:Request){
 try {
  await requireUser();const payload=input.parse(await request.json());const db=admin();
  if(payload.field==='subject'&&(payload.value.length>120||/[\r\n]/.test(payload.value)))throw new Error('Use a subject of up to 120 characters on one line.');
  const {data,error}=await db.from('cards').select('id,status,email_subject,email_body,updated_at,assigned_to,accounts(domain)').in('id',payload.ids).in('status',['new','edited','approved']);
  if(error)throw error;
  const cards=(data??[]).filter(c=>c.assigned_to===payload.owner&&batchOwner((c.accounts as unknown as {domain:string})?.domain??'')===payload.owner&&c.email_body?.trim());
  const updates=cards.map(c=>({id:c.id,before:c.updated_at,subject:payload.field==='subject'?payload.value:c.email_subject,body:payload.field==='opening'?replaceOpening(c.email_body,payload.value):c.email_body}));
  for(const row of updates){
   const errors=firstTouchErrors(row.subject??'',row.body);if(errors.length)throw new Error(errors[0]);
   if(row.body.length>1000)throw new Error('This opening would make a draft too long. Shorten it and try again.');
  }
  const applied:typeof updates=[];
  let warning: string | undefined;
  for(const row of updates){
   const {data:saved,error}=await db.from('cards').update({...(payload.field==='subject'?{email_subject:row.subject}:{email_body:row.body}),status:'edited',active_variant_id:null}).eq('id',row.id).eq('updated_at',row.before).in('status',['new','edited','approved']).select('id');
   if(error){warning="Some drafts could not be saved. Applied changes are shown; retry for the remainder.";break;}if(saved?.length)applied.push(row);
  }
  return Response.json({updates:applied,skipped:payload.ids.length-applied.length,warning});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Could not update drafts.'},{status:400});}
}
