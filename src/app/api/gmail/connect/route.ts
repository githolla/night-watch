import { requireUser } from "@/lib/auth";import { oauthUrl } from "@/lib/gmail";
export async function GET(){try{await requireUser();const owner="josh" as const;return Response.redirect(oauthUrl(owner))}catch{return Response.json({error:"Unauthorized"},{status:401})}}
