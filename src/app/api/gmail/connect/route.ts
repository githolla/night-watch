import { requireUser } from "@/lib/auth";
import { oauthUrl } from "@/lib/gmail";

export async function GET() {
  try {
    await requireUser();
    return Response.redirect(oauthUrl("josh"));
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
}
