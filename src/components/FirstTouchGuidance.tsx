'use client';
import {useState} from 'react';
import {titleGuidance,firstTouchErrors} from '@/lib/first-touch';
export function FirstTouchGuidance({title,subject,body}:{title:string;subject:string;body:string}) {
 const [locations,setLocations]=useState('');
 const errors=firstTouchErrors(subject,body);
 return <details className="research-evidence"><summary>First-email copy and recipient fit{errors.length?' · copy needs review':''}</summary>
 <p>First emails use no links, attachments or open pixels. The saved footer is sent as text.</p>
 {errors.map(error=><p role="alert" key={error}>{error}</p>)}
 <label>Confirmed number of locations <input type="number" min="1" value={locations} placeholder="Unknown" onChange={e=>setLocations(e.target.value)}/></label>
 <p>{titleGuidance(title,locations?Number(locations):undefined)}</p>
 </details>;
}
