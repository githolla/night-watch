import test from 'node:test';
import assert from 'node:assert/strict';
import rows from '../../data/offer-versions.json' with {type:'json'};
import {firstTouchErrors,firstTouchSignature,titleGuidance} from './first-touch.ts';
test('all first-touch variants are link-free, plain and ask one question',()=>{
 for(const row of rows)for(const draft of row.variants)if(draft)assert.deepEqual(firstTouchErrors(draft.subject,draft.message),[],row.contactName);
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
test('formatted first-touch footer keeps saved branding without document chrome, clickable links or image requests',async()=>{
 const {firstTouchFooterHtml}=await import('./first-touch.ts');
 const html='<html><head><title>Gmail Signature</title></head><body><table style="color:#123456"><tr><td><b>Josh Lee</b></td></tr><tr><td>FDE, COO</td></tr><tr><td><a href="https://nine-67.com">nine-67.com</a></td></tr><tr><td>&#9993;</td><td>josh@nine-67.com</td></tr><tr><td><img src="https://example.com/image"></td></tr></table></body></html>';
 const result=firstTouchFooterHtml(html);
 assert.match(result,/<table style="color:#123456">/);assert.match(result,/<b>Josh Lee<\/b>/);
 assert.match(result,/FDE, COO/);assert.doesNotMatch(result,/<head|<title|<html|<body|<a\b|<img|https:|josh@|&#9993;|Gmail Signature/);
 assert.equal((result.match(/<tr>/g)||[]).length,2);
});
