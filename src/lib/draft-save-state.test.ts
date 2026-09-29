import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgedDraftFields, meetingTimesBody } from './draft-save-state.ts';
test('subject response cannot replace newer body or newer subject typing', () => {
 assert.deepEqual(acknowledgedDraftFields({email_subject:'old'},{email_subject:'old',email_body:'stale',updated_at:'2'},{email_subject:1},{email_subject:2,email_body:3}),{updated_at:'2'});
 assert.deepEqual(acknowledgedDraftFields({email_subject:'new'},{email_subject:'new',email_body:'stale'},{email_subject:2},{email_subject:2,email_body:3}),{email_subject:'new'});
});
test('meeting slots replace CTA and leave only one question, last',()=>{
 const body=meetingTimesBody('Hi Pat,\n\nWe build useful tools.\n\nWorth a conversation?\n\nJosh',['Tuesday 2pm','Thursday 3pm']);
 assert.equal((body.match(/\?/g)||[]).length,1);
 assert.ok(body.endsWith('Would one of these times work for a short call?'));
 assert.ok(!body.includes('Worth a conversation'));
});
