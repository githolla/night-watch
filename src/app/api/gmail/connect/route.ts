import { requireUser } from "@/lib/auth";
import { oauthUrl } from "@/lib/gmail";
import { z } from "zod";

const owner = z.enum(["josh", "jenna"]).catch("josh");

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    await requireUser();
    // Don't hand Google a half-built URL (empty client_id) — that returns Google's own 400 page. Bounce back with a clear reason.
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
      return Response.redirect(`${process.env.APP_URL ?? url.origin}/settings?connect=unconfigured`);
    }
    return Response.redirect(oauthUrl(owner.parse(url.searchParams.get("owner"))));
  } catch {
    return Response.redirect(`${process.env.APP_URL ?? url.origin}/login`);
  }
}
