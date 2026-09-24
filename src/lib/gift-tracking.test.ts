import test from 'node:test';
import assert from 'node:assert/strict';
import {giftToken,giftReference,trackedGiftCopy,firstGiftViewAt} from './gift-tracking.ts';
import {contactEvidence} from './research-recommendation.ts';
import {mergeDetection} from './tracking-detection.ts';
import {outreachEmailHtml} from './outreach-ending.ts';
const id=contactEvidence('ansararestaurantgroup.com','Victor Ansara')!.giftId;
const version='00000000-0000-4000-8000-000000000001';
process.env.TOKEN_ENCRYPTION_KEY='gift-tests-only';
test('tracking tokens are purpose bound and reject modified or invalid references',()=>{
 const token=giftToken(id,version);assert.deepEqual(giftReference(token),{assetId:id,versionId:version});assert.equal(giftReference('tampered'+token),null);assert.throws(()=>giftToken('unknown',version));assert.throws(()=>giftToken(id,'bad'));
});
test('Gmail decorates only the selected gift and produces a clickable asset',()=>{
 const url=`https://night-watch-snowy.vercel.app/gift/${id}`;const original=`Your brief: ${url}\n\nUseful?`;
 const html=outreachEmailHtml(original,{fromName:'Josh'});assert.ok(html.includes(`href="${url}"`));const tracked=trackedGiftCopy(html,id,version);assert.match(tracked,/\?t=/);assert.equal(trackedGiftCopy('https://example.com/gift',id,version),'https://example.com/gift');
});
test('asset and image detections retain one another and do not inflate on reload',()=>{
 const opened=mergeDetection('','firstOpenAt','2026-09-24T12:00:00Z')!;const viewed=mergeDetection(opened,'firstGiftViewAt','2026-09-24T12:01:00Z')!;
 assert.equal(JSON.parse(viewed).firstOpenAt,'2026-09-24T12:00:00Z');assert.equal(firstGiftViewAt(viewed),'2026-09-24T12:01:00Z');assert.equal(mergeDetection(viewed,'firstGiftViewAt','2026-09-25T00:00:00Z'),null);assert.equal(firstGiftViewAt('bad'),null);
});

test('resending a tracked asset replaces its token instead of appending another query',()=>{
 const url=`https://night-watch-snowy.vercel.app/gift/${id}`;
 const twice=trackedGiftCopy(trackedGiftCopy(url,id,version),id,version);
 assert.equal(twice.split('?t=').length,2);
 assert.deepEqual(giftReference(twice.split('?t=')[1]),{assetId:id,versionId:version});
});
