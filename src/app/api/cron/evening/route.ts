import { cronAuthorized } from "@/lib/auth";
import { appBase } from "@/lib/app-url";
import { eveningEmail } from "@/lib/daily-email";
import { loadEveningEmail } from "@/lib/daily-email-data";
import { sendEmail } from "@/lib/gmail";
import { localParts } from "@/lib/local-time";
import { isSendDay } from "@/lib/morning-send-rules";
import { admin } from "@/lib/supabase/admin";
import { seatOwner } from "@/lib/types";

/** The evening recap, from each seat's own Gmail to itself, on send days only. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const local = localParts(now);
  if (!isSendDay(local.weekday, local.date)) return Response.json({ skipped: "not a send day" });
  const base = appBase(request);
  const { data: connections } = await admin().from("gmail_connections").select("owner,email");
  const emails: Array<{ owner: string; sent: boolean; subject?: string }> = [];
  const errors: string[] = [];
  for (const connection of connections ?? []) {
    const owner = seatOwner(connection.owner as string);
    if (!owner) continue;
    try {
      const email = eveningEmail(await loadEveningEmail(owner, base, now));
      await sendEmail(owner, `Night Watch <${connection.email as string}>`, connection.email as string, email.subject, email.text, undefined, undefined, email.html);
      emails.push({ owner, sent: true, subject: email.subject });
    } catch (error) {
      errors.push(`${owner}: ${error instanceof Error ? error.message : "Delivery failed"}`);
    }
  }
  return Response.json({ emails, errors });
}
