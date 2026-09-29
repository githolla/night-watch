'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export function BatchPreparation({domains}:{domains:string[]}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const router=useRouter();
 async function prepare(){setBusy(true);try{let done=0;for(const domain of domains){setMessage(`Preparing ${done+1} of ${domains.length} companies…`);const response=await fetch('/api/desk/priority-draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({domain})});if(!response.ok&&response.status!==409){const data=await response.json();throw new Error(data.error??'Could not prepare this company.');}done++;}setMessage('Preparation complete.');router.refresh();}catch(e){setMessage(e instanceof Error?e.message:'Preparation failed. Try again.');}finally{setBusy(false);}}
 return <div className="notice" role="status">{domains.length} companies need preparation. Your existing drafts are available below. <button className="btn" disabled={busy} onClick={prepare}>{busy?'Preparing…':'Prepare remaining companies'}</button>{message&&<p>{message}</p>}</div>;
}
