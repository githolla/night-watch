import { z } from "zod";
export const sendSchema=z.object({cardId:z.uuid(),subject:z.string().max(120),body:z.string().min(1).max(2000)});
/** The base daily send cap per seat (`SEND_DAILY_CAP`, default 15). */
export function baseDailyCap(){const parsed=Number.parseInt(process.env.SEND_DAILY_CAP??"",10);return Number.isFinite(parsed)&&parsed>0?parsed:15}
/** Warmup ramp: a freshly connected mailbox starts at 4/day and climbs ~1/day to the base, so a new
 *  seat never blasts its full volume on day one (which tanks a domain's reputation). */
export function dailyCap(daysConnected:number,base=baseDailyCap()){return Math.max(1,Math.min(base,4+Math.max(0,Math.floor(daysConnected))))}
/** Hard guards on an outbound email. `requireVerified` is on for automated (cadence) sends — no human is
 *  looking, so an unverified/guessed address must never auto-fire. A manual desk send passes false: the
 *  person can see the address and chooses to send, warned in the UI, so it's allowed. */
export function validateEmail(body:string,emailStatus:string,dailyCount:number,cap:number=baseDailyCap(),requireVerified:boolean=true){const urls=body.match(/https?:\/\/\S+/g)??[];const errors:string[]=[];if(requireVerified&&emailStatus!=="verified")errors.push("Recipient email is not verified");if(dailyCount>=cap)errors.push(`Daily sender cap of ${cap} reached`);if(urls.length>1)errors.push("Email may contain at most one link");if(/<\/?[a-z][^>]*>|data:image|tracking pixel/i.test(body))errors.push("Email must be plain text without images or tracking");return errors}
