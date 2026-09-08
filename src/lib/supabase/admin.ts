import { createClient } from "@supabase/supabase-js";
export function admin(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Supabase server environment is not configured");return createClient(url,key,{auth:{persistSession:false}})}
