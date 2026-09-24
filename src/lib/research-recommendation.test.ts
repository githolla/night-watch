import test from 'node:test';
import assert from 'node:assert/strict';
import focus from '../../data/revenue-focus.json' with {type:'json'};
import {contactEvidence,recommendEvidence,researchVersions,giftAsset,type ResearchEvidence} from './research-recommendation.ts';
import {withResearchDefault} from './recommended-draft.ts';
const now=new Date('2026-09-24T12:00:00Z');
const base=contactEvidence('ansararestaurantgroup.com','Victor Ansara')!;
test('all25 companies and28contacts have completed individual gifts and exact-recipient drafts',()=>{
 const ids=new Set<string>();let count=0;
 for(const a of focus)for(const c of a.contacts){
  const row=contactEvidence(a.domain,c.name);assert.ok(row);const asset=giftAsset(row.giftId);assert.ok(asset);assert.equal(asset.contactName,c.name);assert.equal(asset.domain,a.domain);assert.equal(asset.checks.length,3);ids.add(asset.id);
  for(const channel of ['email','linkedin'] as const){const variants=researchVersions(a.domain,c.name,channel,now);assert.ok(variants.some(v=>v.id==='gift'));for(const v of variants){assert.doesNotMatch(v.message+v.subject,/[—–]/);assert.ok(v.message.endsWith('?'));assert.equal((v.message.match(/\?/g)||[]).length,1);assert.ok(v.message.length<950);}}
  assert.doesNotMatch(row.gift.message,/https?:\/\//);count++;
 }
 assert.equal(count,28);assert.equal(ids.size,28);assert.equal(contactEvidence(base.domain,'Not the buyer'),undefined);
});
test('dated relevant triggers outrank peer proof and Gift, but expired/future/undated evidence cannot',()=>{
 const trigger={publishedDate:'2026-09-12',sourceUrl:'https://example.com/news',fact:'A dated announcement',relevantToContact:true,kind:'announcement',subject:'new location',message:'Who owns this?',linkedinMessage:'Who owns this?'};
 const row:ResearchEvidence={...base,trigger,peerProof:{verified:true,closePeer:true,sourceUrl:'https://example.com/case',outcome:'Documented result',subject:'peer example',message:'Useful?',linkedinMessage:'Useful?'}};
 assert.equal(recommendEvidence(row,now).recommended?.id,'trigger');
 for(const date of ['2026-07-01','2026-09-25','', 'not a date'])assert.equal(recommendEvidence({...row,trigger:{...trigger,publishedDate:date}},now).recommended?.id,'peer-proof');
 assert.equal(recommendEvidence({...row,trigger:{...trigger,relevantToContact:false}},now).recommended?.id,'peer-proof');
 assert.equal(recommendEvidence({...base,peerProof:{...row.peerProof!,closePeer:false}},now).recommended?.id,'gift');
 assert.equal(recommendEvidence({...base,giftId:'missing'},now).recommended,null);
});
test('research defaults do not replace edited, approved, sent or selected drafts',()=>{
 const card={status:'new',accounts:{domain:base.domain},people:{full_name:base.contactName},email_subject:'old',email_body:'old'};
 const next=withResearchDefault(card,'Suuchi','Hello {first},');assert.match(next.email_body!,/^Hello Victor,/);assert.doesNotMatch(next.email_body!,/https?:\/\//);assert.notEqual(next.email_subject,'old');
 for(const status of ['edited','approved','sent','archived']){const protectedCard={...card,status};assert.equal(withResearchDefault(protectedCard,'Josh','Hi {first},'),protectedCard);}
 const selected={...card,active_variant_id:'chosen'};assert.equal(withResearchDefault(selected,'Josh','Hi {first},'),selected);
});
