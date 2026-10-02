import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryDetails,recoveryReady } from './delivery-recovery.ts';
import { deliveryReservationId } from './delivery-state.ts';
test('only real deterministic send reservations appear in recovery',()=>{
 const base={id:'ordinary',card_id:'card',person_id:'person',owner:'suuchi',context:'',created_at:'',updated_at:'',status:'selected'};
 assert.equal(recoveryDetails(base),null);
 assert.deepEqual(recoveryDetails({...base,id:deliveryReservationId('card','person')}),{kind:'initial'});
 assert.deepEqual(recoveryDetails({...base,id:deliveryReservationId('cadence:step','person'),context:JSON.stringify({delivery:{kind:'followup',stepId:'step'}})}),{kind:'followup',stepId:'step'});
});
test('active or invalid attempt timestamps cannot be released',()=>{
 const now=Date.parse('2026-09-29T12:00:00Z');assert.equal(recoveryReady('2026-09-29T11:59:00Z',now),false);assert.equal(recoveryReady('invalid',now),false);assert.equal(recoveryReady('2026-09-29T11:49:00Z',now),true);
});
test('scheduled intro recovery preserves its step while sharing the initial-email reservation',()=>{
 const row={id:deliveryReservationId('card','person'),card_id:'card',person_id:'person',owner:'suuchi',context:JSON.stringify({delivery:{kind:'followup',stepId:'step',initialReservation:true}}),created_at:'',updated_at:'',status:'selected'};
 assert.deepEqual(recoveryDetails(row),{kind:'followup',stepId:'step',initialReservation:true});
});
