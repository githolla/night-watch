import Link from 'next/link';
import { admin } from '@/lib/supabase/admin';
import { REPLY_MODEL } from '@/lib/reply-event';
import type { Owner } from '@/lib/types';
export async function ReplyProcessingHealth({owner}:{owner:Owner}){
 const {data,error}=await admin().from('message_experiments').select('id,card_id,status,context,updated_at').eq('owner',owner).eq('model',REPLY_MODEL).order('updated_at',{ascending:false}).limit(100);
 if(error)return <p role="alert">Could not load reply-processing health. Reload to retry.</p>;
 const issues=(data??[]).flatMap(row=>{try{const state=JSON.parse(row.context);return state.error||state.bookingError?[{...row,reason:state.error??state.bookingError}]:[]}catch{return [{...row,reason:'Reply state needs review'}]}});
 return <section className="card"><h2>Reply processing</h2><p>{data?.length?`Last recorded update: ${new Date(data[0].updated_at).toLocaleString('en-US')}`:'No reply events recorded yet.'} · {issues.length} issues in the latest 100 events</p>{issues.map(item=><p key={item.id}>{item.reason} · <Link href={`/desk?card=${item.card_id}`}>Open conversation</Link>{item.status!=='completed'&&' · Processing will retry automatically.'}</p>)}</section>;
}
