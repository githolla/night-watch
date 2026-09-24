import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceOpening} from './bulk-copy.ts';
test('bulk opening preserves individual greetings, company detail and CTA',()=>{
 for(const name of ['Louis','Douglas']){
 const body=`Hi ${name},\n\nOld opening.\n\nCompany-specific detail.\n\nInterested?`;
 const expected=`Hi ${name},\n\nNew opening.\n\nCompany-specific detail.\n\nInterested?`;
 assert.equal(replaceOpening(body,'New opening.'),expected);
 assert.equal(replaceOpening(expected,'New opening.'),expected);
 }
});
test('handles older single-newline greetings and bodies with no greeting',()=>{
 assert.equal(replaceOpening('Hello Louis,\nOld opener.\n\nInterested?','New.'),'Hello Louis,\n\nNew.\n\nInterested?');
 assert.equal(replaceOpening('Old opener.\n\nDetails.\n\nInterested?','New.'),'New.\n\nDetails.\n\nInterested?');
});
