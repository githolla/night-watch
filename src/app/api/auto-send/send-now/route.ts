import { requireUser } from "@/lib/auth";
import { sendNextQueued } from "@/lib/morning-send";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

export const maxDuration = 60;

const input = z.object({ owner: z.enum(["josh", "suuchi"]).optional(), tried: z.array(z.string().uuid()).max(500).default([]) });

/** Send the next email in a seat's auto-send queue now, outside the morning window. One per call; the page paces them. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = input.parse(await request.json());
    const owner = body.owner ?? user.owner;
    if (owner !== user.owner && user.role !== "admin") return Response.json({ error: "You can only send your own emails." }, { status: 403 });
    return Response.json(await sendNextQueued(admin(), owner, { tried: body.tried }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not send" }, { status: 400 });
  }
}
