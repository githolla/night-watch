import test from 'node:test';
import assert from 'node:assert/strict';
import { issueActingSession, actingTarget } from './acting-session.ts';
import { encrypt } from './crypto.ts';
const actor = { id: 'josh', name: 'Josh', email: 'josh@example.com', owner: 'josh' as const, role: 'admin' as const };
process.env.TOKEN_ENCRYPTION_KEY ||= 'test-only-acting-session';
test('acting token resolves only for its original admin', () => {
  const token = issueActingSession(actor.id, 'suuchi');
  assert.equal(actingTarget(token, actor), 'suuchi');
  assert.throws(() => actingTarget(token, { ...actor, id: 'other' }));
  assert.throws(() => actingTarget(token, { ...actor, role: 'member' }));
  assert.throws(() => actingTarget(token + 'tampered', actor));
});
test('expired and wrong-purpose cookies cannot silently choose another sender', () => {
  assert.throws(() => actingTarget(encrypt(JSON.stringify({ purpose: 'act-as', actorId: actor.id, targetId: 'suuchi', exp: Date.now() - 1 })), actor));
  assert.throws(() => actingTarget(encrypt(JSON.stringify({ uid: 'suuchi', boot: true, exp: Date.now() + 10000 })), actor));
});
