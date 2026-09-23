import { requireUser } from "@/lib/auth";
import { preparePriorityDraft } from "@/lib/prepare-priority-draft";

export async function POST(request: Request) {
  try {
    const me = await requireUser();
    const input = await request.json();
    return await preparePriorityDraft(String(input.domain ?? ""), me);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not prepare the selected draft." }, { status: 400 });
  }
}
