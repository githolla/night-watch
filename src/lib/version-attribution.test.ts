import test from 'node:test';
import assert from 'node:assert/strict';
import { savedVariants, renderSavedVariant } from './outreach-variants.ts';
import { identifyVersion, versionLabel, versionMeta } from './version-attribution.ts';
import { aggregateVersions, type TrackedTouch } from './version-analytics.ts';
import { trackedEmailHtml, openTrackingId, firstOpenAt } from './open-tracking.ts';
import { encrypt } from './crypto.ts';
const domain = 'ansararestaurantgroup.com';
const personId = 'person-1';
const variant = savedVariants(domain, 'Victor Ansara')[0];
const draft = renderSavedVariant(variant, 'Victor Ansara', 'Josh Lee');
const base = { domain, personId, contactName: 'Victor Ansara', senderName: 'Josh Lee', ...draft, source: 'gmail' as const };
const selectedMeta = identifyVersion({ ...base, source: 'selection' });
const selected = { ...draft, dimensions: selectedMeta };
const meta = identifyVersion(base, selected);
const touch = (changes: Partial<TrackedTouch> = {}): TrackedTouch => ({ id:'t1',card_id:'c1',person_id:personId,sent_by:'josh',sent_at:'2026-09-23T12:00:00Z',gmail_thread_id:'thread1',reply_at:null,reply_classification:'none',message_variants:{subject:draft.subject,dimensions:meta,message_experiments:{context:''}},...changes });

test('identifies exact saved copy across sender and signature changes',()=>{
 const suuchi = renderSavedVariant(variant, 'Victor Ansara', 'Suuchi Ramesh', 'Hello {first},');
 const result = identifyVersion({...base,...suuchi,body:suuchi.body+'\n\nSuuchi',senderName:'Suuchi Ramesh',greeting:'Hello {first},'},selected);
 assert.equal(result.label,'Personal'); assert.equal(result.edited,false);
});
test('manual edits preserve selected lineage, but cannot borrow another contact attribution',()=>{
 const result=identifyVersion({...base,subject:'a different subject'},selected);
 assert.equal(versionLabel(result),'Personal · edited'); assert.equal(result.revision,selectedMeta.revision);
 assert.equal(identifyVersion({...base,personId:'someone-else',body:'Different copy?'},selected).label,'Custom / other');
 assert.equal(identifyVersion({...base,domain:'other.example',body:'Different copy?'},selected).label,'Custom / other');
 assert.equal(identifyVersion({...base,body:'A completely custom question?'}).label,'Custom / other');
 assert.equal(versionMeta({schema:'saved-email-v1'}),null);
});
test('switching to a different complete version supersedes the old lineage',()=>{
 const other=renderSavedVariant(savedVariants(domain,'Victor Ansara')[3],'Victor Ansara','Josh Lee');
 const result=identifyVersion({...base,...other},selected);
 assert.equal(result.label,'Wildcard'); assert.equal(result.edited,false);
});
test('one conversation, duplicate touches and followups produce one send and reply',()=>{
 const root=touch({message_variants:{subject:draft.subject,dimensions:meta,message_experiments:{context:JSON.stringify({firstOpenAt:'2026-09-23T12:01:00Z'})}}});
 const follow=touch({id:'t2',sent_at:'2026-09-25T12:00:00Z',reply_at:'2026-09-26T12:00:00Z',reply_classification:'positive',message_variants:{subject:'Follow up',dimensions:{...meta,source:'followup'},message_experiments:{context:''}}});
 const summary=aggregateVersions([root,root,follow]);
 assert.deepEqual(summary.rows[0],{label:'Personal',sent:1,gmail:1,manual:0,opens:1,replies:1,positive:1,ooo:0});
 assert.equal(summary.recent[0].subject,draft.subject);
});
test('OOO, previews, legacy copy records and failed sends cannot inflate reply metrics',()=>{
 const ooo=touch({reply_at:'2026-09-23T12:05:00Z',reply_classification:'ooo'});
 const preview=touch({id:'preview',card_id:'c2',message_variants:{subject:'x',dimensions:selectedMeta,message_experiments:{context:''}}});
 const legacyCopy=touch({id:'old-copy',card_id:'c3',gmail_thread_id:null,message_variants:null});
 const failed=touch({id:'failed',card_id:'c4',sent_at:null});
 const result=aggregateVersions([ooo,preview,legacyCopy,failed]);
 assert.equal(result.rows[0].sent,1); assert.equal(result.rows[0].replies,0); assert.equal(result.rows[0].ooo,1);
});
test('source/date filters and edited rows have their own denominators',()=>{
 const manual=touch({id:'m',card_id:'c2',gmail_thread_id:null,message_variants:{subject:draft.subject,dimensions:{...meta,source:'manual',edited:true},message_experiments:{context:''}}});
 assert.equal(aggregateVersions([touch(),manual],{source:'gmail'}).rows[0].sent,1);
 assert.equal(aggregateVersions([touch(),manual],{source:'manual'}).rows[0].label,'Personal · edited');
 assert.equal(aggregateVersions([touch(),manual],{source:'all'}).rows.length,2);
 assert.equal(aggregateVersions([touch()],{since:'2026-09-24T00:00:00Z'}).rows.length,0);
});
test('open tokens are purpose-bound, encrypted and tamper resistant',()=>{
 const before=process.env.TOKEN_ENCRYPTION_KEY;
 process.env.TOKEN_ENCRYPTION_KEY='unit-test-only-key';
 try {
  const id='11111111-2222-3333-4444-555555555555';
  const html=trackedEmailHtml('<p>Hello</p>','https://example.com',id);
  const src=html.match(/src="([^"]+)"/)![1];
  const token=new URL(src).searchParams.get('t')!;
  assert.equal(openTrackingId(token),id);
  assert.equal(openTrackingId(token+'x'),null);
  assert.equal(openTrackingId(encrypt(id)),null);
  assert.equal(openTrackingId('bad'),null);
  assert.ok(!src.includes(id));
  assert.equal(firstOpenAt('bad'),null);
 } finally { if(before===undefined) delete process.env.TOKEN_ENCRYPTION_KEY;else process.env.TOKEN_ENCRYPTION_KEY=before; }
});

test('an unchanged archived selection stays unedited even after the draft bank changes',()=>{
 const archived={subject:'An older subject',body:'Hi Victor,\n\nAn older approved question?',dimensions:selectedMeta};
 const result=identifyVersion({...base,subject:archived.subject,body:archived.body},archived);
 assert.equal(result.label,'Personal'); assert.equal(result.edited,false); assert.equal(result.revision,selectedMeta.revision);
});

test('self-test metadata is readable but is never an outreach cohort',()=>{
 const testMeta=identifyVersion({...base,source:'test'},selected);
 assert.equal(versionMeta(testMeta)?.source,'test');
 assert.equal(testMeta.label,'Personal');
 const record=touch({message_variants:{subject:'[Night Watch test] '+draft.subject,dimensions:testMeta,message_experiments:{context:''}}});
 assert.equal(aggregateVersions([record]).rows.length,0);
});
