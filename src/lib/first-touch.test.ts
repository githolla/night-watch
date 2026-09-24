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
test('saved signature retains contact details in the plain alternative',()=>{
 const signature=firstTouchSignature('<p>Josh Lee<br>COO</p><a href="https://nine-67.com">nine-67.com</a><p>josh@nine-67.com</p>');
 assert.equal(signature,'Josh Lee\nCOO\nnine-67.com\njosh@nine-67.com');
});
test('large groups require workflow owners without claiming unknown company scale',()=>{
 assert.match(titleGuidance('CEO',200),/COO or VP/);
 assert.match(titleGuidance('CEO'),/unconfirmed/);
 assert.match(titleGuidance('CEO',20),/smaller group/);
});
test('uploaded signature preserves images, links and layout but excludes document chrome',async()=>{
 const {firstTouchFooterHtml}=await import('./first-touch.ts');
 for (const name of ['Josh Lee','Suuchi Ramesh']) {
  const signature=`<html><head><title>Gmail signature</title></head><body><table width="420"><tr><td><img src="https://example.com/logo.png" width="100" onerror="bad()"></td><td style="padding-left:16px"><b>${name}</b><br>COO<br><a href="mailto:sender@nine-67.com">sender@nine-67.com</a></td></tr></table></body></html>`;
  const result=firstTouchFooterHtml(signature);
  assert.match(result,/<table width="420"/);assert.match(result,/<img src="https:\/\/example.com\/logo.png"/);
  assert.match(result,/padding-left:16px/);assert.match(result,/mailto:sender@nine-67.com/);
  assert.doesNotMatch(result,/<head|<title|<html|<body|onerror|Gmail signature/);
  assert.match(firstTouchSignature(signature),new RegExp(name));
 }
});
