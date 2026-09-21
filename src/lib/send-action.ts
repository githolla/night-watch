import { z } from "zod";import { validateEmail as rules } from "./send-guards.ts";
export const sendInput=z.object({subject:z.string().min(1).max(120),body:z.string().min(1).max(1000)});
export function validateEmail(status:string,count:number,body:string,cap?:number,requireVerified:boolean=true){const errors=rules(body,status,count,cap,requireVerified);if(errors.length)throw new Error(errors.join("; "))}
