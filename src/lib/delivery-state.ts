import { createHash } from 'node:crypto';

export class DeliveryError extends Error {
  code: 'delivery_unknown' | 'delivery_reserved' | 'delivery_rejected';
  constructor(code: DeliveryError['code'], message: string) {
    super(message); this.code = code;
  }
}

/** A stable database primary key reserves one initial email per card and recipient, across servers. */
export function deliveryReservationId(cardId: string, personId: string) {
  const hex = createHash('sha256').update(JSON.stringify(['initial-email-v1', cardId, personId])).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

/** A card's first email. After a bounce, a resend to a corrected address gets its own reservation, once per bounce. */
export function initialReservationId(cardId: string, personId: string, resend = 0) {
  return resend > 0 ? deliveryReservationId(`${cardId}:resend:${resend}`, personId) : deliveryReservationId(cardId, personId);
}

export function deliveryErrorResponse(error: unknown) {
  const delivery = error instanceof DeliveryError;
  return Response.json({ error: error instanceof Error ? error.message : 'Send failed', code: delivery ? error.code : undefined },
    { status: delivery ? (error.code === 'delivery_unknown' ? 502 : 409) : 400 });
}

/** Once the request starts, lack of a valid receipt is uncertainty, never proof of non-delivery. */
export async function gmailSendRequest(token: string, raw: string, threadId?: string, request: typeof fetch = fetch) {
  const unknown = () => new DeliveryError('delivery_unknown', 'Send status unknown. Gmail may have received the email. Check the sender’s Sent folder before retrying to avoid a duplicate.');
  let response: Response;
  try {
    response = await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw, threadId }), signal: AbortSignal.timeout(20000),
    });
  } catch { throw unknown(); }
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      throw new DeliveryError('delivery_rejected', `Gmail rejected the send (${response.status}). Nothing was sent by this request.`);
    }
    throw unknown();
  }
  try {
    const data = await response.json();
    if (typeof data.id !== 'string' || !data.id.trim() || typeof data.threadId !== 'string' || !data.threadId.trim()) throw unknown();
    return { id: data.id as string, threadId: data.threadId as string };
  } catch { throw unknown(); }
}
