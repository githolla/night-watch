'use client';
import {useCallback,useEffect,useState} from 'react';
type Account={owner:string;name:string;email:string|null;connected:boolean;detail:string};
export function ConnectionHealth({isAdmin=true}:{isAdmin?:boolean}){
 const [accounts,setAccounts]=useState<Account[]>([]);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [checked,setChecked]=useState('');
 const check=useCallback(async()=>{
  setBusy(true);setError('');setAccounts([]);
  try {const response=await fetch(isAdmin?'/api/admin/connection-health':'/api/gmail/health',{cache:'no-store',signal:AbortSignal.timeout(35000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Connection check failed.');setAccounts(data.accounts);setChecked(data.checkedAt);}
  catch(e){setError(e instanceof Error?e.message:'Connection check failed.');}
  finally{setBusy(false);}
 },[isAdmin]);
 useEffect(()=>{const timer=setTimeout(()=>{void check();},0);return()=>clearTimeout(timer);},[check]);
 return <section className="connection-health" aria-label="Team connection status">
  <header><div><h2>Email connections</h2><p>Green: connected. Red: needs attention. This check does not send email.</p></div><button type="button" className="btn" onClick={check} disabled={busy}>{busy?'Checking…':'Check connections'}</button></header>
  <div className="connection-health-grid" aria-live="polite">
   {busy&&<p>Checking Google access…</p>}
   {error&&<p role="alert">Unable to verify connections: {error}</p>}
   {accounts.map(a=><article key={a.owner}><div className="connection-health-title"><strong>{a.name}</strong><span className={a.connected?'connection-light is-green':'connection-light is-red'}><i aria-hidden="true"/>{a.connected?'Connected':'Needs attention'}</span></div><p>{a.email||'No mailbox connected'}</p><small>{a.detail}</small>{!a.connected&&<a href="/settings?tab=sending">Open email settings →</a>}</article>)}
  </div>
  {checked&&!busy&&!error&&<small>Last checked {new Date(checked).toLocaleTimeString()}. Connection status does not confirm inbox delivery or signature setup.</small>}
 </section>;
}
