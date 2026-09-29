import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryError, deliveryReservationId, gmailSendRequest, deliveryErrorResponse } from './delivery-state.ts';

test('reservation keys are stable across users and processes but distinct for colleagues', () => {
  assert.equal(deliveryReservationId('card','person'), deliveryReservationId('card','person'));
  assert.notEqual(deliveryReservationId('card','person'), deliveryReservationId('card','colleague'));
  assert.match(deliveryReservationId('card','person'), /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-a[\da-f]{3}-[\da-f]{12}$/);
});
for (const [label, request] of [
  ['connection dropped', async () => { throw new TypeError('network'); }],
  ['server error', async () => new Response('', {status:503})],
  ['request timeout', async () => new Response('', {status:408})],
  ['invalid receipt', async () => Response.json({})],
  ['unreadable receipt', async () => new Response('{')],
] as const) {
  test(`Gmail ${label} retains uncertain delivery instead of claiming not sent`, async () => {
    await assert.rejects(gmailSendRequest('token','mime',undefined,request), (e: unknown) => e instanceof DeliveryError && e.code === 'delivery_unknown');
  });
}
test('explicit Gmail rejection permits a retry', async () => {
  await assert.rejects(gmailSendRequest('token','mime',undefined,async()=>new Response('',{status:403})), (e: unknown) => e instanceof DeliveryError && e.code === 'delivery_rejected');
});
test('successful Gmail response requires both message and thread ids', async () => {
  assert.deepEqual(await gmailSendRequest('token','mime',undefined,async()=>Response.json({id:'message',threadId:'thread'})),{id:'message',threadId:'thread'});
});
test('unknown outcome is transmitted explicitly to the UI', async () => {
  const r=deliveryErrorResponse(new DeliveryError('delivery_unknown','Check Sent'));
  assert.equal(r.status,502);assert.equal((await r.json()).code,'delivery_unknown');
});
