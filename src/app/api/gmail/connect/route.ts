import { requireUser } from "@/lib/auth";
import { oauthUrl } from "@/lib/gmail";
import { z } from "zod";

const owner = z.enum(["josh", "jenna"]).catch("josh");

export async function GET(request: Request) {
  try {
    await requireUser();
    return Response.redirect(oauthUrl(owner.parse(new URL(request.url).searchParams.get("owner"))));
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
}
