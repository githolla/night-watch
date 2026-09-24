import test from 'node:test';
import assert from 'node:assert/strict';
import focus from '../../data/revenue-focus.json' with { type: 'json' };
import { savedVariants, withDefaultLinkedIn, withDefaultEmail, renderSavedVariant, renderLinkedInVariant } from './outreach-variants.ts';

test('all 28 contacts have complete, evidence-eligible authored versions', () => {
  let count = 0;
  for (const account of focus) for (const contact of account.contacts) {
    const variants = savedVariants(account.domain, contact.name);
    assert.ok(variants.some(v => v.id === 'gift'));
    assert.ok(variants.every(v => ['Trigger', 'Business Idea', 'Gift', 'Peer Proof', 'Proof'].includes(v.label)));
    assert.equal(new Set(variants.map(v => v.message)).size, variants.length);
    for (const variant of variants) {
      assert.ok(variant.subject.trim());
      assert.ok(variant.message.endsWith('?'));
      assert.doesNotMatch(variant.subject + variant.message, /[—–]/);
      assert.doesNotMatch(variant.message, /\bJosh\b/);
      const rendered = renderSavedVariant(variant, contact.name, 'Suuchi Ramesh', 'Hello {first},');
      assert.ok(rendered.body.startsWith(`Hello ${contact.name.split(' ')[0]},`));
      assert.doesNotMatch(rendered.body, /\{sender\}|\bJosh\b/);
      assert.ok(rendered.body.length <= 1000, `${contact.name}: exceeds save limit`);
      count++;
    }
  }
  assert.equal(count, 84);
});
test('never presents another contact or company drafts as an available version', () => {
  assert.deepEqual(savedVariants('caymanchem.com', 'Unknown Person'), []);
  assert.deepEqual(savedVariants('unknown.example', 'Victor Ansara'), []);
  assert.deepEqual(savedVariants(null, null), []);
  assert.equal(savedVariants('https://www.ansararestaurantgroup.com/', ' victor   ansara ').length, 3);
});
test('authored introductions follow sender settings, with no invented fallback name', () => {
  const [variant] = savedVariants('ansararestaurantgroup.com', 'Victor Ansara');
  assert.match(renderSavedVariant(variant, 'Victor Ansara', 'Suuchi Ramesh').body, /I'm Suuchi at Nine-67/);
  assert.match(renderSavedVariant(variant, 'Victor Ansara', '').body, /We're Nine-67/);
});

test('all contacts have evidence-eligible LinkedIn messages with no email footer or model call', () => {
  let count = 0;
  for (const account of focus) for (const contact of account.contacts) {
    const variants = savedVariants(account.domain, contact.name, 'linkedin');
    assert.ok(variants.some(v => v.id === 'gift'));
    assert.ok(variants.every(v => ['Trigger', 'Business Idea', 'Gift', 'Peer Proof', 'Proof'].includes(v.label)));
    assert.equal(new Set(variants.map(v => v.message)).size, variants.length);
    for (const variant of variants) {
      const rendered = renderLinkedInVariant(variant, 'Suuchi Ramesh');
      assert.ok(rendered.body.length <= 1500);
      assert.ok(rendered.body.trim().endsWith('?'));
      assert.doesNotMatch(rendered.body, /[—–]|\{sender\}|<table|Thank you,|\bJosh\b/);
      assert.ok(!savedVariants(account.domain, contact.name).some(email => email.message === variant.message));
      count++;
    }
  }
  assert.equal(count, 84);
  assert.deepEqual(savedVariants('caymanchem.com', 'Unknown Person', 'linkedin'), []);
});

test('blank current LinkedIn draft opens with the recommendation while existing edits stay intact', () => {
  const card = { accounts: { domain: 'ansararestaurantgroup.com' }, people: { full_name: 'Victor Ansara' }, linkedin_message: '', linkedin_subject: '' };
  const expected = renderLinkedInVariant(savedVariants(card.accounts.domain, card.people.full_name, 'linkedin').find(v=>v.id==='gift')!, 'Suuchi Ramesh');
  for (const missing of ['', '   ', null, undefined]) {
    const result = withDefaultLinkedIn({ ...card, linkedin_message: missing }, 'Suuchi Ramesh');
    assert.equal(result.linkedin_message, expected.body);
    assert.equal(result.linkedin_subject, expected.subject);
  }
  const edited = { ...card, linkedin_message: 'My own note?', linkedin_subject: 'My subject' };
  assert.equal(withDefaultLinkedIn(edited, 'Josh'), edited);
  const unknown = { ...card, people: { full_name: 'Unknown' } };
  assert.equal(withDefaultLinkedIn(unknown, 'Josh'), unknown);
});

test('blank new emails populate exact-contact reviewed defaults without replacing protected copies', () => {
 const account = focus[0], person = account.contacts[0];
 const blank = { status: 'new', accounts: { domain: account.domain }, people: { full_name: person.name }, email_body: null, email_subject: null };
 const filled = withDefaultEmail(blank, 'Hello {first},');
 assert.equal(filled.email_body, `Hello Victor,\n\n${person.message}`);
 assert.equal(filled.email_subject, person.subject);
 for (const status of ['edited','approved','sent','replied']) {
  const protectedCard = { ...blank, status };
  assert.equal(withDefaultEmail(protectedCard), protectedCard);
 }
 const edited = { ...blank, email_body: 'My words' };
 assert.equal(withDefaultEmail(edited), edited);
 const stranger = { ...blank, people: { full_name: 'Someone Else' } };
 assert.equal(withDefaultEmail(stranger), stranger);
});
