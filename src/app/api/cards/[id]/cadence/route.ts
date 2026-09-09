import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const step=z.object({day:z.number().int().min(0).max(30),channel:z.enum(["email","linkedin_comment","linkedin_request","linkedin_message","intro_ask"]),title:z.string().min(1).max(120),detail:z.string().min(1).max(300),subject:z.string().max(120).optional(),body:z.string().max(1500).optional()});
const cadenceInput=z.object({mode:z.enum(["manual","automatic"]),stopOnReply:z.boolean(),weekdaysOnly:z.boolean(),sendWindow:z.string().max(40),timeZone:z.string().min(1).max(80),steps:z.array(step).min(1).max(8)});

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const user=await requireUser(),{id}=await context.params,input=cadenceInput.parse(await request.json()),db=admin();
    const {data:card}=await db.from("cards").select("id,person_id,assigned_to,people(email_status,do_not_contact),accounts(status)").eq("id",id).single();
    if(!card)throw new Error("Card not found");
    const owner=user.email?.startsWith("jenna")?"jenna":"josh";
    if(owner!==card.assigned_to)throw new Error("Only the assigned owner may activate this cadence");
    const person=card.people as unknown as {email_status:string;do_not_contact:boolean},account=card.accounts as unknown as {status:string};
    if(person.do_not_contact||["client","do_not_contact"].includes(account.status))throw new Error("Do-not-contact guard blocked this cadence");
    if(input.mode==="automatic"&&input.steps.some(item=>item.channel==="email")&&person.email_status!=="verified")throw new Error("Automatic email requires a verified address");
    const {data:cadence,error}=await db.from("cadences").upsert({card_id:id,person_id:card.person_id,owner:card.assigned_to,mode:input.mode,status:"active",rules:{stop_on_reply:input.stopOnReply,weekdays_only:input.weekdaysOnly,send_window:input.sendWindow,time_zone:input.timeZone},activated_at:new Date().toISOString()},{onConflict:"card_id"}).select("id").single();
    if(error||!cadence)throw new Error(error?.message??"Unable to create cadence");
    await db.from("cadence_steps").delete().eq("cadence_id",cadence.id);
    const activated=new Date(),rows=input.steps.map((item,index)=>({cadence_id:cadence.id,step_number:index+1,channel:item.channel,kind:item.channel==="email"&&input.mode==="automatic"?"automatic":"review",title:item.title,detail:item.detail,subject:item.subject??null,body:item.body??null,status:"pending",scheduled_at:schedule(activated,item.day,input.weekdaysOnly,input.timeZone)}));
    const {error:stepsError}=await db.from("cadence_steps").insert(rows);if(stepsError)throw new Error(stepsError.message);
    await db.from("cards").update({status:"approved"}).eq("id",id);
    return Response.json({ok:true,cadenceId:cadence.id,steps:rows.length});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Cadence failed"},{status:400})}
}

function schedule(start:Date,days:number,weekdaysOnly:boolean,timeZone:string){
  const local=parts(start,timeZone),cursor=new Date(Date.UTC(local.year,local.month-1,local.day));
  let remaining=days;
  while(remaining>0){cursor.setUTCDate(cursor.getUTCDate()+1);if(!weekdaysOnly||![0,6].includes(cursor.getUTCDay()))remaining--}
  if(days===0){
    const blockedWeekend=weekdaysOnly&&[0,6].includes(cursor.getUTCDay());
    if(!blockedWeekend&&(local.hour<9||(local.hour===9&&local.minute<30)))return zoned(cursor,10,0,timeZone).toISOString();
    if(!blockedWeekend&&(local.hour<11||(local.hour===11&&local.minute<=25)))return new Date(start.getTime()+5*60_000).toISOString();
    do cursor.setUTCDate(cursor.getUTCDate()+1);while(weekdaysOnly&&[0,6].includes(cursor.getUTCDay()));
  }
  return zoned(cursor,10,0,timeZone).toISOString();
}

function parts(value:Date,timeZone:string){
  const values=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",hourCycle:"h23"}).formatToParts(value).map(part=>[part.type,part.value]));
  return {year:Number(values.year),month:Number(values.month),day:Number(values.day),hour:Number(values.hour),minute:Number(values.minute)};
}

function zoned(day:Date,hour:number,minute:number,timeZone:string){
  const desired=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),hour,minute);
  let guess=new Date(desired);
  for(let pass=0;pass<2;pass++){
    const seen=parts(guess,timeZone),represented=Date.UTC(seen.year,seen.month-1,seen.day,seen.hour,seen.minute);
    guess=new Date(guess.getTime()+desired-represented);
  }
  return guess;
}
