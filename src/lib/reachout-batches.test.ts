import test from 'node:test';
import assert from 'node:assert/strict';
import { batchProgress, type BatchCard } from './reachout-batches.ts';
import { batchFocus, originalFocus, nextBatchFocus, focusForOwner, batchOwner, reachoutList } from './focus-data.ts';
import { savedVariants, renderSavedVariant, renderLinkedInVariant } from './outreach-variants.ts';
import { firstTouchErrors } from './first-touch.ts';
import { publishedEmailPatch } from './focused-contact.ts';

const cardsFor = (owner: 'josh' | 'jenna', status = 'sent'): BatchCard[] => focusForOwner(owner).map(row => ({domain: row.domain, owner, status}));

test('next batches contain 25 distinct operating businesses per sender, never merged with current or retired companies', () => {
  assert.equal(nextBatchFocus.length, 50);
  assert.equal(new Set([...originalFocus, ...batchFocus, ...nextBatchFocus].map(r => r.domain)).size, 125);
  for (const owner of ['josh', 'jenna'] as const) {
    const next = focusForOwner(owner, 2);
    assert.equal(next.length, 25);
    assert.deepEqual(reachoutList(owner === 'josh' ? 'josh' : 'suuchi', owner, 2).drafts, next);
    next.forEach((row, i) => {
      assert.equal(batchOwner(row.domain), owner);
      assert.ok(row.revenue.usdMillions >= 10 && row.revenue.usdMillions <= 100);
      if (i) assert.ok(next[i-1].revenue.usdMillions >= row.revenue.usdMillions);
      assert.ok(row.contacts[0].sourceUrl.startsWith('https://'));
      assert.ok(row.revenue.sourceUrl.startsWith('https://'));
    });
  }
});

test('missing, approved, snoozed, edited and archived companies cannot unlock the next batch', () => {
  for (const status of ['new','edited','approved','snoozed','archived']) {
    const cards = cardsFor('josh'); cards[24].status = status;
    assert.equal(batchProgress('josh', cards).sequence, 1, status);
    assert.equal(batchProgress('josh', cards).completed, 24);
  }
  assert.equal(batchProgress('josh', cardsFor('josh').slice(0,24)).sequence, 1);
  assert.equal(batchProgress('josh', []).sequence, 1);
});

test('sender progress is independent and sending or explicit dismissal unlocks only the finished sender', () => {
  const cards = [...cardsFor('josh'), ...cardsFor('jenna','new')];
  assert.equal(batchProgress('josh', cards).sequence, 2);
  assert.equal(batchProgress('jenna', cards).sequence, 1);
  assert.equal(batchProgress('jenna', cardsFor('jenna','dismissed')).sequence, 2);
  for (const status of ['replied','positive','negative','meeting']) assert.equal(batchProgress('josh',cardsFor('josh',status)).sequence,2);
  const wrongOwner = cardsFor('josh').map(c=>({...c,owner:'jenna'}));
  assert.equal(batchProgress('josh',wrongOwner).sequence,1);
  const mixed = cardsFor('josh','dismissed');
  mixed.push({...mixed[0],status:'new'});
  assert.equal(batchProgress('josh',mixed).sequence,1);
});

test('recorded outreach remains complete when a follow-up changes the card status', () => {
  const cards = cardsFor('josh','snoozed').map(card => ({...card,contacted:true}));
  assert.equal(batchProgress('josh',cards).sequence,2);
  const completedOnLoad=focusForOwner('josh').slice(0,24).map(row=>row.domain);
  assert.equal(batchProgress('josh',[cardsFor('josh')[24]],completedOnLoad).sequence,2);
  assert.equal(batchProgress('jenna',[],completedOnLoad).sequence,1);
});

test('all 50 next contacts have three complete authored email and LinkedIn variants with correct sender identity', () => {
  for (const row of nextBatchFocus) {
    const sender = row.assignedOwner === 'josh' ? 'Josh' : 'Suuchi';
    for (const channel of ['email','linkedin'] as const) {
      const variants = savedVariants(row.domain,row.buyer.name,channel);
      assert.deepEqual(variants.map(v=>v.id), ['direct-offer','concrete-idea','delivery-experience'], row.domain);
      for (const variant of variants) {
        const draft = channel === 'email' ? renderSavedVariant(variant,row.buyer.name,sender) : renderLinkedInVariant(variant,sender);
        assert.ok(draft.body.includes(`I'm ${sender} at Nine-67`),row.domain);
        assert.ok(draft.body.endsWith('?'),row.domain);
        assert.deepEqual(firstTouchErrors(draft.subject,draft.body),[],row.domain);
        assert.ok(draft.body.length < 1200,row.domain);
        assert.ok(!draft.body.includes('{sender}'),row.domain);
      }
    }
    const patch = publishedEmailPatch(row.domain,row.buyer.name,{email:null});
    assert.equal(patch.email,row.buyer.email,row.domain);
    assert.equal(patch.email_status,'unverified',row.domain);
    assert.deepEqual(publishedEmailPatch(row.domain,row.buyer.name,{email:'saved@example.com',email_status:'verified'}),{});
    assert.deepEqual(publishedEmailPatch(row.domain,row.buyer.name,{email:null,do_not_contact:true}),{});
    if(row.contacts[0].emailStatus==='inferred') assert.match(row.contacts[0].emailNote,/hypothesis|Inferred/);
  }
});
