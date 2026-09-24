import test from 'node:test';
import assert from 'node:assert/strict';
import rows from '../../data/research-outreach.json' with {type:'json'};
import {firstTouchErrors,firstTouchSignature,titleGuidance} from './first-touch.ts';
test('all first-touch variants are link-free, plain and ask one question',()=>{
 for(const row of rows)for(const draft of [row.gift,row.trigger,row.businessIdea,row.deliveryProof])if(draft)assert.deepEqual(firstTouchErrors(draft.subject,draft.message),[],row.contactName);
});
test('edited drafts cannot introduce links, jargon or extra questions',()=>{
 assert.ok(firstTouchErrors('Hi','Want this? Another question?').length);
 assert.ok(firstTouchErrors('AI-powered solutions','Want this?').length);
 assert.ok(firstTouchErrors('Hi','Read https://example.com. Want it?').length);
 assert.ok(firstTouchErrors('Hi','Read example.com. Want it?').length);
});
test('first-touch footer removes external content but preserves name and role',()=>{
 const signature=firstTouchSignature('<p>Josh Lee<br>COO</p><a href="https://nine-67.com">nine-67.com</a><img src="https://example.com/pixel"><p>josh@nine-67.com</p>');
 assert.equal(signature,'Josh Lee\nCOO');
});
test('large groups require workflow owners without claiming unknown company scale',()=>{
 assert.match(titleGuidance('CEO',200),/COO or VP/);
 assert.match(titleGuidance('CEO'),/unconfirmed/);
 assert.match(titleGuidance('CEO',20),/smaller group/);
});
test('uploaded signature documents do not leak titles, encoded icons or duplicate sender names',()=>{
 const html='<html><head><title>Nine-67 Gmail Signature - Josh Lee</title><style>p{color:red}</style></head><body><p>Josh Lee</p><p>FDE, COO</p><p>&amp;#9993;</p><p>&#9678;</p><p>&#8982;</p><p>Business &amp; Operations</p><p>+1 555 123 4567</p></body></html>';
 assert.equal(firstTouchSignature(html,'Josh'),'FDE, COO\nBusiness & Operations\n+1 555 123 4567');
 assert.doesNotMatch(firstTouchSignature(html,'Josh'),/Signature|&#|Josh|color:red/);
});
