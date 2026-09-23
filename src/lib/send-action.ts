import { emailStyle } from "./email-style.ts";
import { z } from "zod";import { validateEmail as rules } from "./send-guards.ts";
// personId: send to a colleague picked from the company's team list instead of the card's default
// contact. The route checks that person is at the SAME company before anything leaves.
export const sendInput=z.object({subject:z.string().min(1).max(120).transform(emailStyle),body:z.string().min(1).max(1000).transform(emailStyle),personId:z.string().trim().min(1).max(64).optional()});
export function validateEmail(status:string,count:number,body:string,cap?:number,requireVerified:boolean=true){const errors=rules(body,status,count,cap,requireVerified);if(errors.length)throw new Error(errors.join("; "))}
