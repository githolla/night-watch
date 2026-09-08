import { requireUser } from "@/lib/auth";import { oauthUrl } from "@/lib/gmail";
export async function GET(){try{const user=await requireUser(),owner=user.email?.startsWith("jenna")?"jenna":"josh";return Response.redirect(oauthUrl(owner))}catch{return Response.json({error:"Unauthorized"},{status:401})}}
