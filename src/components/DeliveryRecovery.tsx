'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
type Attempt={id:string;card_id:string;created_at:string;ready:boolean;people:{full_name:string;email:string};cards:{accounts:{name:string}};message_variants:Array<{subject:string}>;details:{kind:string;legacy?:boolean}};
export function DeliveryRecovery(){
 const [items,setItems]=useState<Attempt[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[checked,setChecked]=useState<string[]>([]),[confirmed,setConfirmed]=useState<string[]>([]),[legacyFound,setLegacyFound]=useState<string[]>([]);
 const load=useCallback(async()=>{setLoading(true);try{const response=await fetch('/api/delivery-recovery',{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error);setItems(data.attempts);}catch(e){setNotice(e instanceof Error?e.message:'Could not load delivery attempts.');}finally{setLoading(false);}},[]);
 useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[load]);
 async function resolve(id:string,action:'check'|'release'|'confirmSent'){
  setBusy(id);setNotice('');try{const response=await fetch('/api/delivery-recovery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,action,confirmedNotSent:confirmed.includes(id),confirmedSent:action==='confirmSent'})});const data=await response.json();if(!response.ok)throw new Error(data.error);setNotice(data.message);if(data.legacyFound)setLegacyFound(old=>[...old,id]);if(data.notFound)setChecked(old=>[...old,id]);if(data.resolved)await load();}catch(e){setNotice(e instanceof Error?e.message:'Could not check this attempt. Nothing was sent.');}finally{setBusy('');}
 }
 return <section className="feature-center" style={{maxWidth:1000,margin:'28px auto',padding:24}}>
  <h1>Delivery recovery</h1><p>These sends need confirmation for your mailbox. Checking or releasing an attempt never sends an email.</p>
  <button className="btn" onClick={()=>void load()} disabled={loading||!!busy}>Refresh</button>
  {notice&&<p className="notice" role="status">{notice}</p>}
  {loading?<p>Loading attempts…</p>:!items.length?<p>No initial or follow-up sends need confirmation for your account.</p>:items.map(item=><article key={item.id} style={{borderTop:'1px solid #dedbd3',padding:'22px 0'}}>
   <h2>{item.cards?.accounts?.name??'Company'} · {item.people?.full_name}</h2>
   <p>{item.people?.email} · {new Date(item.created_at).toLocaleString()} · {item.details.kind==='followup'?'Follow-up':'Initial email'}</p>
   <strong>{item.message_variants?.[0]?.subject??'Message preparation interrupted'}</strong>
   <p>{item.ready?'Check Gmail before retrying this message.':'A send may still be in progress. Recovery is available ten minutes after the attempt.'}</p>
   <div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button className="btn primary" disabled={!item.ready||!!busy} onClick={()=>void resolve(item.id,'check')}>{busy===item.id?'Checking…':'Check Gmail Sent'}</button><a className="btn" href="https://mail.google.com/mail/u/0/#sent" target="_blank" rel="noreferrer">Open Gmail Sent</a><Link className="btn" href={`/outreach?card=${item.card_id}`}>Open draft</Link></div>
   {legacyFound.includes(item.id)&&<p><button className="btn" disabled={!!busy} onClick={()=>void resolve(item.id,'confirmSent')}>I checked Gmail and confirm this follow-up was sent</button></p>}
   {checked.includes(item.id)&&<div style={{marginTop:18}}><label><input type="checkbox" checked={confirmed.includes(item.id)} onChange={e=>setConfirmed(old=>e.target.checked?[...old,item.id]:old.filter(id=>id!==item.id))}/> I checked the correct sender’s Gmail Sent for this recipient and subject and confirmed this email was not sent.</label><p><button className="btn" disabled={!confirmed.includes(item.id)||!!busy} onClick={()=>void resolve(item.id,'release')}>Release for a manual retry</button></p></div>}
  </article>)}
 </section>;
}
