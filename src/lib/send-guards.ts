import { z } from "zod";
export const sendSchema=z.object({cardId:z.uuid(),subject:z.string().max(120),body:z.string().min(1).max(2000)});
/**
 * The base daily send cap per seat (`SEND_DAILY_CAP`, default 40).
 *
 * 40 a day per mailbox is the usual ceiling for cold outreach from a warmed domain — Google allows far
 * more, but volume is what gets a domain filtered, not the allowance. Two seats at 40 is 80 a day.
 */
export function baseDailyCap(){const parsed=Number.parseInt(process.env.SEND_DAILY_CAP??"",10);return Number.isFinite(parsed)&&parsed>0?parsed:40}
/** How much the warmup adds per day (`SEND_RAMP_PER_DAY`, default 5). */
export function rampPerDay(){const parsed=Number.parseInt(process.env.SEND_RAMP_PER_DAY??"",10);return Number.isFinite(parsed)&&parsed>0?parsed:5}
/**
 * Warmup ramp: a freshly connected mailbox starts at 5/day and climbs to the base, so a new seat never
 * blasts its full volume on day one, which is what tanks a domain's reputation.
 *
 * The ramp used to add 1/day, so a base of 40 would have taken 36 days to reach and raising the cap would
 * have changed almost nothing for a month. At 5/day the base is reached in about a week.
 */
export function dailyCap(daysConnected:number,base=baseDailyCap(),step=rampPerDay()){return Math.max(1,Math.min(base,5+step*Math.max(0,Math.floor(daysConnected))))}

/**
 * Midnight in the operator's own timezone (`SEND_TIMEZONE`, default America/New_York), as an instant.
 *
 * The cap window was computed with setHours(0,0,0,0) on the server, which is UTC on Vercel — so for an
 * Eastern operator the day rolled over at 8pm and an evening session could send a second full day's quota.
 */
export function sendDayStart(now:Date=new Date(),timeZone:string=process.env.SEND_TIMEZONE??"America/New_York"):Date{
  const offset=zoneOffsetMs(now,timeZone);
  const local=new Date(now.getTime()+offset);
  local.setUTCHours(0,0,0,0);
  return new Date(local.getTime()-offset);
}
function zoneOffsetMs(date:Date,timeZone:string):number{
  try{
    const parts=new Intl.DateTimeFormat("en-US",{timeZone,hour12:false,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(date);
    const get=(type:string)=>Number(parts.find((part)=>part.type===type)?.value??"0");
    return Date.UTC(get("year"),get("month")-1,get("day"),get("hour")%24,get("minute"),get("second"))-date.getTime();
  }catch{return 0} // an unknown zone falls back to UTC rather than throwing mid-send
}
/** Hard guards on an outbound email. `requireVerified` is on for automated (cadence) sends — no human is
 *  looking, so an unverified/guessed address must never auto-fire. A manual desk send passes false: the
 *  person can see the address and chooses to send, warned in the UI, so it's allowed. */
export function validateEmail(body:string,emailStatus:string,dailyCount:number,cap:number=baseDailyCap(),requireVerified:boolean=true){const urls=body.match(/https?:\/\/\S+/g)??[];const errors:string[]=[];if(requireVerified&&emailStatus!=="verified")errors.push("Recipient email is not verified");if(dailyCount>=cap)errors.push(`Daily sender cap of ${cap} reached`);if(urls.length>1)errors.push("Email may contain at most one link");if(/<\/?[a-z][^>]*>|data:image|tracking pixel/i.test(body))errors.push("Email must be plain text without images or tracking");return errors}
