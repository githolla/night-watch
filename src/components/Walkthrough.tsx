'use client';
import {useEffect,useRef,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {Compass,X} from 'lucide-react';
import {createPortal} from 'react-dom';
import {tourSteps} from '@/lib/tour-steps';
export function Walkthrough({userKey}:{userKey?:string}){
 const path=usePathname(),router=useRouter();
 const [menu,setMenu]=useState(false),[index,setIndex]=useState<number|null>(null),[rect,setRect]=useState<{left:number;top:number;width:number;height:number}|null>(null);
 const [ready,setReady]=useState(false);
 const dialog=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const key=`nightwatch-tour-v1:${userKey??'guest'}`;
 const step=index===null?null:tourSteps[index];
 useEffect(()=>{
  const timer=setTimeout(()=>{
   setReady(true);if(!userKey)return;
   try {const pending=sessionStorage.getItem(key);const value=pending===null?null:Number(pending);
    if(value!==null&&Number.isInteger(value)&&value>=0&&value<tourSteps.length)setIndex(value);
    else if(!localStorage.getItem(key))setMenu(true);
   }catch{/* A tour still works when browser storage is unavailable. */}
  },100);return()=>clearTimeout(timer);
 },[key,userKey]);
 function close(){setMenu(false);setIndex(null);setRect(null);try{localStorage.setItem(key,'seen');sessionStorage.removeItem(key);}catch{}trigger.current?.focus();}
 function go(next:number){
  if(next>=tourSteps.length){close();return;}
  setMenu(false);setRect(null);setIndex(next);
  try{localStorage.setItem(key,'seen');sessionStorage.setItem(key,String(next));}catch{}
  if(path!==tourSteps[next].path)router.push(tourSteps[next].path);
 }
 useEffect(()=>{
  if(!step||path!==step.path)return;
  let target:HTMLElement|null=null,opened:HTMLDetailsElement|null=null,scrolled=false;
  function measure(){
   target=document.querySelector<HTMLElement>(step!.target);
   if(!target||!target.getClientRects().length){setRect(null);return;}
   if('expand' in step!&&step!.expand&&target instanceof HTMLDetailsElement&&!target.open){target.open=true;opened=target;}
   if(!scrolled){scrolled=true;target.scrollIntoView({block:'center',behavior:'instant'});}
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
 const top=rect?Math.max(16,Math.min(rect.top+rect.height+14,window.innerHeight-320)):undefined;
 return <><button ref={trigger} type="button" className="appbar-tour" title="Tour and user guide" aria-label="Tour and user guide" onClick={()=>setMenu(true)}><Compass size={18}/><span>Tour</span></button>
 {ready&&(menu||step)&&createPortal(<div className="walkthrough-layer">
  <div className={`walkthrough-shield ${rect&&!menu?'has-spotlight':''}`} />
  {!menu&&rect&&<div className="walkthrough-spotlight" style={rect}/>}
  <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="walkthrough-title" className={`walkthrough-card ${!rect||menu?'centered':''}`} style={!menu&&rect?{left,top,width}:undefined}>
   <button className="walkthrough-close" aria-label="Close tour" onClick={close}><X size={18}/></button>
   <span className="walkthrough-eyebrow">{menu?'NIGHT WATCH · GETTING STARTED':`STEP ${(index??0)+1} OF ${tourSteps.length}`}</span>
   <h2 id="walkthrough-title">{menu?'From first draft to first reply':step?.title}</h2>
   <p>{menu?'A guided tour of your sender setup, drafts, self-tests and results. The tour never sends an email or saves draft changes.':step?.body}</p>
   {!menu&&!rect&&<small className="walkthrough-fallback">{path!==step?.path?'Opening this page…':'This control may be hidden or unavailable here. In the composer, choose Edit to show editing fields.'}</small>}
   {menu?<><button className="btn primary" onClick={()=>go(0)}>Start walkthrough →</button><button className="btn" onClick={()=>go(Math.max(0,tourSteps.findIndex(s=>s.path===path)))}>Tour this page</button><a className="walkthrough-guide" href="/guides/night-watch-user-guide.pdf" target="_blank" rel="noreferrer">Download the user guide (PDF) ↗</a></>:<><div className="walkthrough-progress"><span style={{width:`${((index??0)+1)/tourSteps.length*100}%`}}/></div><div className="walkthrough-controls"><button className="btn" disabled={index===0} onClick={()=>go((index??0)-1)}>Back</button><button className="btn primary" onClick={()=>go((index??0)+1)}>{index===tourSteps.length-1?'Finish tour':'Next →'}</button></div></>}
  </div>
 </div>,document.body)}
 </>;
}
