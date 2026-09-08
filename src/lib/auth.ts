import { serverClient } from "./supabase/server";
export async function requireUser(){const supabase=await serverClient();const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error("Unauthorized");const allowed=(process.env.ALLOWED_EMAILS??"").split(",").map(x=>x.trim().toLowerCase());if(!user.email||!allowed.includes(user.email.toLowerCase()))throw new Error("Forbidden");return user}
export function cronAuthorized(request:Request){const secret=process.env.CRON_SECRET;return Boolean(secret&&request.headers.get("authorization")===`Bearer ${secret}`)}
