import { serverClient } from "@/lib/supabase/server";import { NextResponse } from "next/server";
export async function GET(request:Request){const url=new URL(request.url),code=url.searchParams.get("code");if(code)await (await serverClient()).auth.exchangeCodeForSession(code);return NextResponse.redirect(new URL("/",url.origin))}
