import { deliveryErrorResponse } from '@/lib/delivery-state';
import { requireUser } from "@/lib/auth";
import { sendCardEmail } from "@/lib/card-send";
import { sendInput } from "@/lib/send-action";
import { outboundBaseUrl } from "@/lib/urls";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const parsed = sendInput.parse(await request.json());
    const result = await sendCardEmail(admin(), { cardId: id, owner: user.owner, actor: user.actor, subject: parsed.subject, body: parsed.body, personId: parsed.personId, baseUrl: outboundBaseUrl(request) });
    return Response.json(result);
  } catch (error) {
    return deliveryErrorResponse(error);
  }
}
