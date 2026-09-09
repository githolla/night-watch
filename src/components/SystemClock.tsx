"use client";

import { useEffect, useState } from "react";

export function SystemClock(){
  const [now,setNow]=useState<Date|null>(null);
  useEffect(()=>{
    const first=window.setTimeout(()=>setNow(new Date()),0);
    const timer=window.setInterval(()=>setNow(new Date()),1000);
    return()=>{window.clearTimeout(first);window.clearInterval(timer)};
  },[]);
  const time=now?.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false})??"--:--";
  const seconds=now?.getSeconds().toString().padStart(2,"0")??"--";
  const zone=now?Intl.DateTimeFormat().resolvedOptions().timeZone.replace("_"," ").toUpperCase():"LOCAL SYSTEM";
  return <div className="system-clock" aria-label="Local operating time"><span className="clock-orbit"/><div><strong>{time}</strong><sup>{seconds}</sup><small>LOCAL OPERATING TIME<br/>{zone}</small></div></div>
}
