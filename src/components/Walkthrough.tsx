'use client';
import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import {Compass,X} from 'lucide-react';
import {createPortal} from 'react-dom';
import {tourSteps} from '@/lib/tour-steps';
export function Walkthrough({userKey}:{userKey?:string}){
 const path=usePathname();
 const [menu,setMenu]=useState(false),[index,setIndex]=useState<number|null>(null),[rect,setRect]=useState<{left:number;top:number;width:number;height:number}|null>(null);
 const [ready,setReady]=useState(false);
 const dialog=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const key=`nightwatch-tour-v1:${userKey??'guest'}`;
 const [routeSteps,setRouteSteps]=useState<number[]>([]);
 const step=index===null?null:tourSteps[routeSteps[index]];
 useEffect(()=>{
  const timer=setTimeout(()=>{
   setReady(true);if(!userKey)return;
   try {if(!localStorage.getItem(key))setMenu(true);
   }catch{/* A tour still works when browser storage is unavailable. */}
  },100);return()=>clearTimeout(timer);
 },[key,userKey]);
 function close(){setMenu(false);setIndex(null);setRect(null);try{localStorage.setItem(key,'seen');}catch{}trigger.current?.focus();}
 function start(bulk=false){
  const chosen=tourSteps.map((s,i)=>({s,i})).filter(({s,i})=>s.path===path && (bulk ? [6,7].includes(i) : ![3,6,7].includes(i))).filter(({s})=>{const el=document.querySelector(s.target);return bulk||(el&&el.getClientRects().length);}).map(({i})=>i);
  if(!chosen.length)return;
  setRouteSteps(chosen);setMenu(false);setRect(null);setIndex(chosen.length?0:null);
  try{localStorage.setItem(key,'seen');}catch{}
 }
 function go(next:number){if(next>=routeSteps.length){close();return;}setRect(null);setIndex(next);}
 useEffect(()=>{const timer=setTimeout(()=>{setIndex(null);setRect(null);},0);return()=>clearTimeout(timer);},[path]);
 useEffect(()=>{
  if(!step||path!==step.path)return;
  let target:HTMLElement|null=null,opened:HTMLDetailsElement|null=null,scrolled=false;
  function measure(){
   target=document.querySelector<HTMLElement>(step!.target);
   if(!target||!target.getClientRects().length){setRect(null);return;}
   if('expand' in step!&&step!.expand&&target instanceof HTMLDetailsElement&&!target.open){target.open=true;opened=target;}
   if(!scrolled){scrolled=true;const bounds=target.getBoundingClientRect();if(bounds.top<72||bounds.bottom>innerHeight-180)target.scrollIntoView({block:'center',behavior:'smooth'});}
   const r=target.getBoundingClientRect();
   setRect({left:Math.max(6,r.left-6),top:Math.max(6,r.top-6),width:Math.min(r.width+12,innerWidth-12),height:Math.min(r.height+12,innerHeight-12)});
  }
  const timer=setTimeout(measure,150),observer=new MutationObserver(()=>{if(!target)measure();});observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);
  return()=>{clearTimeout(timer);observer.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);if(opened)opened.open=false;};
 },[step,path]);
 useEffect(()=>{
  if(!menu&&index===null)return;
  const timer=setTimeout(()=>dialog.current?.focus(),50);
  function keys(e:KeyboardEvent){
   if(e.key==='Escape'){e.preventDefault();close();}
   if(e.key==='Tab'){
    const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]');if(!items?.length)return;
    const first=items[0],last=items[items.length-1];
    if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){e.preventDefault();first.focus();}
   }
  }
  document.addEventListener('keydown',keys);return()=>{clearTimeout(timer);document.removeEventListener('keydown',keys);};
 // close uses the current user key and trigger only.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[menu,index,key]);
 const width=ready?Math.min(370,window.innerWidth-32):370;
 const left=rect?Math.max(16,Math.min(rect.left,window.innerWidth-width-16)):undefined;
 const top=rect?(rect.top+rect.height+310<window.innerHeight?rect.top+rect.height+14:Math.max(16,rect.top-310)):undefined;
 return <><button ref={trigger} type="button" className="appbar-tour" title="Tour and user guide" aria-label="Tour and user guide" onClick={()=>setMenu(true)}><Compass size={18}/><span>Tour</span></button>
 {ready&&(menu||step)&&createPortal(<div className="walkthrough-layer">
  <div className={`walkthrough-shield ${rect&&!menu?'has-spotlight':''}`} />
  {!menu&&rect&&<div className="walkthrough-spotlight" style={rect}/>}
  <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="walkthrough-title" className={`walkthrough-card ${!rect||menu?'centered':''}`} style={!menu&&rect?{left,top,width}:undefined}>
   <button className="walkthrough-close" aria-label="Close tour" onClick={close}><X size={18}/></button>
   <span className="walkthrough-eyebrow">{menu?'NIGHT WATCH · GETTING STARTED':`STEP ${(index??0)+1} OF ${routeSteps.length}`}</span>
   <h2 id="walkthrough-title">{menu?'A quick tour of this page':step?.title}</h2>
   <p>{menu?'A few short spotlights, right here. No page changes, no emails sent, and no draft changes. Close anytime with Escape.':step?.body}</p>
   {!menu&&!rect&&<small className="walkthrough-fallback">{path!==step?.path?'Opening this page…':'This control may be hidden or unavailable here. In the composer, choose Edit to show editing fields.'}</small>}
   {menu?<>{tourSteps.some(s=>s.path===path)&&<button className="btn primary" onClick={()=>start()}>Show me this page →</button>}{path==='/outreach'&&<button className="btn" onClick={()=>start(true)}>Subject &amp; opening help</button>}<a className="walkthrough-guide" href="/guides/night-watch-user-guide.pdf" target="_blank" rel="noreferrer">Download the visual user guide (PDF) ↗</a></>:<><div className="walkthrough-progress"><span style={{width:`${((index??0)+1)/routeSteps.length*100}%`}}/></div><div className="walkthrough-controls"><button className="btn" disabled={index===0} onClick={()=>go((index??0)-1)}>Back</button><button className="btn primary" onClick={()=>go((index??0)+1)}>{index===routeSteps.length-1?'Done':'Next →'}</button></div></>}
  </div>
 </div>,document.body)}
 </>;
}
