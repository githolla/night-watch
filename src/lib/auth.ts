import { cookies } from "next/headers";
import { SESSION_COOKIE, sharedUser, validSharedSession } from "./shared-auth.ts";

export async function requireUser() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!validSharedSession(session)) throw new Error("Unauthorized");
  return sharedUser();
}
export function cronAuthorized(request:Request){const secret=process.env.CRON_SECRET;return Boolean(secret&&request.headers.get("authorization")===`Bearer ${secret}`)}
