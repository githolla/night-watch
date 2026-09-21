import { requireUser } from "@/lib/auth";
import { ownerAccessToken, threadText } from "@/lib/gmail";
import type { Owner } from "@/lib/types";
import { admin } from "@/lib/supabase/admin";

// Read the full sent email back from Gmail (by the touch's stored thread), so History can show the
// entire message — including sends composed directly in Gmail, which were only logged as a snippet.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const db = admin();
    const { data: touch } = await db.from("touches").select("gmail_thread_id,sent_by,channel,body").eq("id", id).single();
    if (!touch) return Response.json({ error: "Not found" }, { status: 404 });
    if (touch.channel !== "email" || !touch.gmail_thread_id) return Response.json({ body: touch.body ?? "" });
    let token: string;
    try { token = await ownerAccessToken(touch.sent_by as Owner); } catch { return Response.json({ body: touch.body ?? "" }); }
    try {
      const msg = await threadText(token, touch.gmail_thread_id);
      return Response.json({ subject: msg.subject, body: msg.body || touch.body || "" });
    } catch {
      return Response.json({ body: touch.body ?? "" });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 400 });
  }
}
