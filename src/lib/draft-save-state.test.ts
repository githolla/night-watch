import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgedDraftFields, meetingTimesBody, resolveSaveConflict } from './draft-save-state.ts';
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
test('a background write is retried against the stored version, a sent card is not',()=>{
 // The repair pass rewrote the body: retry with the fresh version, keep the operator's words, tell them.
 const moved=resolveSaveConflict({email_body:'mine'},{status:'edited',updated_at:'v2',email_body:'repaired'});
 assert.deepEqual(moved,{retry:true,replaced:true,version:'v2'});
 // Her text is already stored (an earlier blur saved it): retry quietly, nothing was replaced.
 assert.deepEqual(resolveSaveConflict({email_body:'mine'},{status:'new',updated_at:'v2',email_body:'mine'}),{retry:true,replaced:false,version:'v2'});
 // Left the editable statuses: a real conflict, never written over.
 assert.deepEqual(resolveSaveConflict({email_body:'mine'},{status:'sent',updated_at:'v2',email_body:'sent copy'}),{retry:false,replaced:false});
 assert.deepEqual(resolveSaveConflict({email_body:'mine'},null),{retry:false,replaced:false});
 // A background write that left the text alone (a rescore, a stamp) replaces nothing, even though the new
 // edit differs from the stored copy: the stored copy is still what this editor last saved.
 assert.deepEqual(resolveSaveConflict({email_body:'edit two'},{status:'edited',updated_at:'v3',email_body:'edit one'},{email_body:'edit one'}),{retry:true,replaced:false,version:'v3'});
 // Someone else changed the text since this editor last saved: say so.
 assert.deepEqual(resolveSaveConflict({email_body:'edit two'},{status:'edited',updated_at:'v3',email_body:'repaired'},{email_body:'edit one'}),{retry:true,replaced:true,version:'v3'});
 // A field the save is not writing never counts as a replacement.
 assert.deepEqual(resolveSaveConflict({email_body:'mine'},{status:'edited',updated_at:'v2',email_body:'mine',email_subject:'theirs'}),{retry:true,replaced:false,version:'v2'});
});
