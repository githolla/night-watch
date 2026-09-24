'use client';
import { useEffect } from 'react';
export function GiftViewSignal({token}:{token:string}) {
 useEffect(()=>{
  let sent=false;
  const detect=()=>{if(sent||document.visibilityState!=='visible')return;sent=true;void fetch('/api/gift-view',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token}),keepalive:true}).catch(()=>{});};
  detect();document.addEventListener('visibilitychange',detect);return()=>document.removeEventListener('visibilitychange',detect);
 },[token]);
 return null;
}
